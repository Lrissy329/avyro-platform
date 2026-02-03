import type { NextApiRequest, NextApiResponse } from "next";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

type TransportResponse = {
  ok: boolean;
  error?: string;
  details?: unknown;
};

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DEFAULT_TIME_ZONE = "Europe/London";
const TRANSIT_MAX_TRANSFERS = 2;
const TRANSIT_MAX_WALKING_MINUTES = 20;
const TRANSIT_MAX_WALKING_SHARE = 0.35;

const roundTo = (value: number, precision: number) => {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
};

const estimateTaxiCost = (distanceKm: number | null) => {
  if (!Number.isFinite(distanceKm ?? NaN)) {
    return { min: null, max: null };
  }
  const baseFare = 3.0;
  const perKmLow = 1.2;
  const perKmHigh = 2.0;
  const min = Math.max(baseFare, baseFare + (distanceKm as number) * perKmLow);
  const max = Math.max(min, baseFare + (distanceKm as number) * perKmHigh);
  return {
    min: roundTo(min, 2),
    max: roundTo(max, 2),
  };
};

const fetchDirections = async (
  origin: [number, number],
  destination: [number, number],
  mode: "transit" | "driving",
  options?: {
    transitMode?: "bus" | "rail";
    alternatives?: boolean;
    departureTime?: number;
  }
) => {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  }
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${origin[1]},${origin[0]}`);
  url.searchParams.set("destination", `${destination[1]},${destination[0]}`);
  url.searchParams.set("mode", mode);
  if (mode === "transit" && options?.transitMode) {
    url.searchParams.set("transit_mode", options.transitMode);
  }
  if (mode === "transit" && options?.alternatives) {
    url.searchParams.set("alternatives", "true");
  }
  if (options?.departureTime) {
    url.searchParams.set("departure_time", String(options.departureTime));
  }
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok || data.status !== "OK") {
    const msg = data?.error_message ? ` ${data.error_message}` : "";
    throw new Error(`Directions ${mode} failed: ${data.status}${msg}`);
  }
  return Array.isArray(data.routes) ? data.routes : [];
};

const pickShortestRoute = (routes: any[]) => {
  let best: { route: any; duration: number } | null = null;
  routes.forEach((route) => {
    const duration = route?.legs?.[0]?.duration?.value;
    if (!Number.isFinite(duration)) return;
    if (!best || duration < best.duration) {
      best = { route, duration };
    }
  });
  return best?.route ?? null;
};

const pickPreferredTransitRoute = (routes: any[]) => {
  if (!Array.isArray(routes) || routes.length === 0) return null;
  const scored = routes
    .map((route) => {
      const leg = route?.legs?.[0];
      const duration = leg?.duration?.value;
      if (!Number.isFinite(duration)) return null;
      const steps = Array.isArray(leg.steps) ? leg.steps : [];
      const walkingSeconds = steps
        .filter((step: any) => step.travel_mode === "WALKING")
        .reduce((sum: number, step: any) => sum + (step.duration?.value ?? 0), 0);
      const transitSteps = steps.filter((step: any) => step.travel_mode === "TRANSIT");
      const transfers = transitSteps.length ? Math.max(0, transitSteps.length - 1) : 0;
      const walkingShare = duration ? walkingSeconds / duration : 0;
      return {
        route,
        duration,
        transfers,
        walkingMinutes: walkingSeconds / 60,
        walkingShare,
      };
    })
    .filter(Boolean) as Array<{
    route: any;
    duration: number;
    transfers: number;
    walkingMinutes: number;
    walkingShare: number;
  }>;

  if (scored.length === 0) return null;

  const filtered = scored.filter(
    (entry) =>
      entry.transfers <= TRANSIT_MAX_TRANSFERS &&
      entry.walkingMinutes <= TRANSIT_MAX_WALKING_MINUTES &&
      entry.walkingShare <= TRANSIT_MAX_WALKING_SHARE
  );
  const pool = filtered.length ? filtered : scored;
  return pool.sort((a, b) => a.duration - b.duration)[0].route ?? null;
};

const parseTransitSummary = (route: any) => {
  const leg = route?.legs?.[0];
  if (!leg) {
    return {
      durationMinutes: null,
      transfers: null,
      modes: [] as string[],
    };
  }
  const durationMinutes = leg.duration?.value
    ? Math.round(leg.duration.value / 60)
    : null;
  const steps = Array.isArray(leg.steps) ? leg.steps : [];
  const transitSteps = steps.filter((step: any) => step.travel_mode === "TRANSIT");
  const transfers = transitSteps.length ? Math.max(0, transitSteps.length - 1) : 0;
  const modes = Array.from(
    new Set(
      transitSteps
        .map((step: any) => step.transit_details?.line?.vehicle?.type)
        .filter(Boolean)
    )
  ) as string[];
  return { durationMinutes, transfers, modes };
};

const parseDrivingSummary = (route: any) => {
  const leg = route?.legs?.[0];
  if (!leg) {
    return {
      durationMinutes: null,
      distanceKm: null,
    };
  }
  const durationMinutes = leg.duration?.value
    ? Math.round(leg.duration.value / 60)
    : null;
  const distanceKm = leg.distance?.value
    ? roundTo(leg.distance.value / 1000, 1)
    : null;
  return { durationMinutes, distanceKm };
};

const getTimeZoneParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
};

const getTimeZoneOffset = (date: Date, timeZone: string) => {
  const parts = getTimeZoneParts(date, timeZone);
  const utcDate = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return utcDate - date.getTime();
};

const zonedTimeToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
) => {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = getTimeZoneOffset(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
};

const getNextOffPeakTimestamp = (hour: number, timeZone: string) => {
  const now = new Date();
  const nowParts = getTimeZoneParts(now, timeZone);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const allowedWeekdays = new Set([2, 3, 4]); // Tue–Thu
  let candidate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));

  for (let i = 0; i < 14; i += 1) {
    const weekday = candidate.getUTCDay();
    const isAllowed = allowedWeekdays.has(weekday);
    const isToday = i === 0;
    if (isAllowed && (!isToday || nowMinutes <= hour * 60)) {
      const target = zonedTimeToUtc(
        candidate.getUTCFullYear(),
        candidate.getUTCMonth() + 1,
        candidate.getUTCDate(),
        hour,
        0,
        timeZone
      );
      return Math.floor(target.getTime() / 1000);
    }
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  const fallback = zonedTimeToUtc(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    hour,
    0,
    timeZone
  );
  return Math.floor(fallback.getTime() / 1000);
};

const computeTypicalAndBuffer = (day: number | null, evening: number | null) => {
  const typical = day ?? evening ?? null;
  if (typical == null) {
    return { typical: null, buffer: null };
  }
  if (day != null && evening != null) {
    return { typical: day, buffer: Math.max(day, evening) };
  }
  return { typical, buffer: Math.round(typical * 1.2) };
};

const selectShortestRoute = (results: Array<{ route: any; label: string; coords: [number, number] } | null>) =>
  results
    .filter(Boolean)
    .reduce<{ route: any; label: string; coords: [number, number] } | null>((best, current) => {
      if (!current) return best;
      const duration = current.route?.legs?.[0]?.duration?.value ?? null;
      if (!Number.isFinite(duration)) return best;
      if (!best) return current;
      const bestDuration = best.route?.legs?.[0]?.duration?.value ?? null;
      if (!Number.isFinite(bestDuration) || duration < bestDuration) {
        return current;
      }
      return best;
    }, null);

export default async function handler(req: NextApiRequest, res: NextApiResponse<TransportResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { listingId } = (req.body ?? {}) as { listingId?: string };
  if (!listingId) {
    return res.status(400).json({ ok: false, error: "listingId is required." });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("id, latitude, longitude, airport_code, primary_poi_id")
      .eq("id", listingId)
      .single();

    if (listingError || !listing) {
      return res.status(404).json({ ok: false, error: listingError?.message ?? "Listing not found." });
    }

    const lat = Number((listing as any).latitude);
    const lng = Number((listing as any).longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "Listing has no coordinates." });
    }

    let poiId = (listing as any).primary_poi_id as string | null;
    let poi: { id: string; latitude: number; longitude: number } | null = null;

    if (!poiId && listing.airport_code) {
      const { data: poiRow } = await supabase
        .from("professional_pois")
        .select("id, latitude, longitude")
        .eq("type", "airport")
        .eq("code", listing.airport_code)
        .single();
      if (poiRow) {
        poiId = poiRow.id;
        poi = poiRow;
        await supabase
          .from("listings")
          .update({ primary_poi_id: poiId })
          .eq("id", listingId);
      }
    }

    if (!poi && poiId) {
      const { data: poiRow, error: poiError } = await supabase
        .from("professional_pois")
        .select("id, latitude, longitude")
        .eq("id", poiId)
        .single();
      if (poiError || !poiRow) {
        return res.status(400).json({ ok: false, error: "Primary POI not found." });
      }
      poi = poiRow;
    }

    if (!poi) {
      return res.status(400).json({ ok: false, error: "No primary POI linked to this listing." });
    }

    const origin: [number, number] = [lng, lat];
    const destination: [number, number] = [poi.longitude, poi.latitude];
    const timeZone = DEFAULT_TIME_ZONE;

    let accessNodes: Array<{
      node_type: string;
      name: string | null;
      latitude: number;
      longitude: number;
    }> = [];
    const { data: nodeRows, error: nodeError } = await supabase
      .from("professional_poi_access_nodes")
      .select("node_type, name, latitude, longitude")
      .eq("poi_id", poi.id);
    if (nodeError) {
      const errorCode = (nodeError as any).code;
      if (errorCode !== "42P01") {
        console.warn("[transport] access node lookup failed", nodeError.message);
      }
    } else if (nodeRows) {
      accessNodes = nodeRows.filter(
        (node) => Number.isFinite(node.latitude) && Number.isFinite(node.longitude)
      );
    }

    const drivingNode = accessNodes.find((node) => node.node_type === "driving");
    const drivingTarget: [number, number] = drivingNode
      ? [drivingNode.longitude, drivingNode.latitude]
      : destination;

    const transitTargets = accessNodes
      .filter((node) => node.node_type === "transit_bus" || node.node_type === "transit_rail")
      .map((node) => ({
        label: node.name ?? (node.node_type === "transit_bus" ? "Coach" : "Rail"),
        coords: [node.longitude, node.latitude] as [number, number],
        transitMode: node.node_type === "transit_bus" ? ("bus" as const) : ("rail" as const),
      }));

    const resolvedTransitTargets =
      transitTargets.length > 0
        ? transitTargets
        : [
            {
              label: "POI",
              coords: destination,
              transitMode: undefined,
            },
          ];

    const departureTimes = {
      day: getNextOffPeakTimestamp(11, timeZone),
      evening: getNextOffPeakTimestamp(20, timeZone),
    };

    const fetchBestTransitForTime = async (departureTime: number) => {
      const results = await Promise.all(
        resolvedTransitTargets.map(async (target) => {
          try {
            const routes = await fetchDirections(origin, target.coords, "transit", {
              transitMode: target.transitMode,
              alternatives: true,
              departureTime,
            });
            const best = pickPreferredTransitRoute(routes) ?? pickShortestRoute(routes);
            if (!best) return null;
            return { route: best, label: target.label, coords: target.coords };
          } catch (err) {
            console.warn("[transport] transit lookup failed", target.label, err);
            return null;
          }
        })
      );
      return selectShortestRoute(results);
    };

    const transitBestDay = await fetchBestTransitForTime(departureTimes.day);
    const transitBestEvening = await fetchBestTransitForTime(departureTimes.evening);
    const drivingRoutesDay = await fetchDirections(origin, drivingTarget, "driving", {
      departureTime: departureTimes.day,
    });
    const drivingRoutesEvening = await fetchDirections(origin, drivingTarget, "driving", {
      departureTime: departureTimes.evening,
    });

    const drivingRouteDay = pickShortestRoute(drivingRoutesDay);
    const drivingRouteEvening = pickShortestRoute(drivingRoutesEvening);

    console.info(
      "[transport] origin",
      origin,
      "driving target",
      drivingTarget,
      "time zone",
      timeZone
    );
    console.info("[transport] departure_time", departureTimes);
    if (transitBestDay) {
      console.info(
        "[transport] transit (day)",
        transitBestDay.label,
        transitBestDay.coords,
        "maps",
        `https://www.google.com/maps/dir/?api=1&origin=${origin[1]},${origin[0]}&destination=${transitBestDay.coords[1]},${transitBestDay.coords[0]}&travelmode=transit`
      );
    }
    if (transitBestEvening) {
      console.info(
        "[transport] transit (evening)",
        transitBestEvening.label,
        transitBestEvening.coords,
        "maps",
        `https://www.google.com/maps/dir/?api=1&origin=${origin[1]},${origin[0]}&destination=${transitBestEvening.coords[1]},${transitBestEvening.coords[0]}&travelmode=transit`
      );
    }

    const transitDaySummary = parseTransitSummary(transitBestDay?.route);
    const transitEveningSummary = parseTransitSummary(transitBestEvening?.route);
    const transitMetaSummary = parseTransitSummary(
      (transitBestDay?.route ?? transitBestEvening?.route) as any
    );
    const transitTiming = computeTypicalAndBuffer(
      transitDaySummary.durationMinutes,
      transitEveningSummary.durationMinutes
    );

    const drivingDaySummary = parseDrivingSummary(drivingRouteDay);
    const drivingEveningSummary = parseDrivingSummary(drivingRouteEvening);
    const drivingTiming = computeTypicalAndBuffer(
      drivingDaySummary.durationMinutes,
      drivingEveningSummary.durationMinutes
    );
    const drivingDistanceKm =
      drivingDaySummary.distanceKm ?? drivingEveningSummary.distanceKm ?? null;
    const taxiEstimate = estimateTaxiCost(drivingDistanceKm);

    const { error: upsertError } = await supabase
      .from("listing_transport_summaries")
      .upsert(
        {
          listing_id: listingId,
          poi_id: poi.id,
          public_transport_duration_minutes: transitTiming.typical,
          public_transport_typical_minutes: transitTiming.typical,
          public_transport_buffer_minutes: transitTiming.buffer,
          public_transport_transfers: transitMetaSummary.transfers,
          public_transport_modes: transitMetaSummary.modes,
          public_transport_updated_at: new Date().toISOString(),
          taxi_duration_minutes: drivingTiming.typical,
          taxi_typical_minutes: drivingTiming.typical,
          taxi_buffer_minutes: drivingTiming.buffer,
          taxi_distance_km: drivingDistanceKm,
          taxi_cost_min: taxiEstimate.min,
          taxi_cost_max: taxiEstimate.max,
          taxi_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "listing_id,poi_id" }
      );

    if (upsertError) {
      return res.status(500).json({ ok: false, error: upsertError.message, details: upsertError });
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[api/transport/refresh]", err);
    return res.status(500).json({ ok: false, error: err?.message ?? "Transport lookup failed.", details: err });
  }
}
