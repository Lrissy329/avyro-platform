import type { NextApiRequest, NextApiResponse } from "next";

import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { isMissingColumnError } from "@/lib/flexStay";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { drivingLegSeconds, firstDepartureLocal } from "@/lib/transportTimes";

type TransportResponse = {
  ok: boolean;
  skipped?: "cooldown" | "fresh";
  error?: string;
};

// Every refresh costs several paid Google requests, so a listing is never refreshed more often than this
// (even when forced), and an un-forced call is skipped while the saved result is still fresh.
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const FRESH_FOR_MS = 24 * 60 * 60 * 1000;
// "Can I get there before a 06:00 report?" -- the earliest public transport asked for from this time.
const EARLY_DEPARTURE_HOUR = 4;

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
  const seconds = drivingLegSeconds(leg);
  const durationMinutes = seconds ? Math.round(seconds / 60) : null;
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

const pickEarliestDeparture = (routes: any[]) => {
  let best: any = null;
  let bestAt = Number.POSITIVE_INFINITY;
  routes.forEach((route) => {
    const at = route?.legs?.[0]?.departure_time?.value;
    if (Number.isFinite(at) && at < bestAt) {
      best = route;
      bestAt = at;
    }
  });
  return best;
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

  const { listingId, force } = (req.body ?? {}) as { listingId?: string; force?: boolean };
  if (!listingId || typeof listingId !== "string") {
    return res.status(400).json({ ok: false, error: "listingId is required." });
  }

  // Only the signed-in owner of a listing may refresh its travel times. This route spends money on Google
  // and writes with the service-role client, so it must never be callable anonymously.
  const authClient = createPagesServerClient({ req, res });
  const {
    data: { session },
  } = await authClient.auth.getSession();
  if (!session?.user?.id) {
    return res.status(401).json({ ok: false, error: "Sign in to refresh travel times." });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("id, user_id, latitude, longitude, airport_code, primary_poi_id")
      .eq("id", listingId)
      .single();

    if (listingError || !listing) {
      return res.status(404).json({ ok: false, error: "Listing not found." });
    }
    if ((listing as any).user_id !== session.user.id) {
      return res.status(403).json({ ok: false, error: "You can only refresh your own listings." });
    }

    const lat = Number((listing as any).latitude);
    const lng = Number((listing as any).longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "Listing has no coordinates." });
    }

    // The listing's airport code is the source of truth. primary_poi_id is only a cached link, and the edit
    // form changes airport_code without touching it, so trust the code first and repair the link.
    let poi: { id: string; latitude: number; longitude: number } | null = null;

    if (listing.airport_code) {
      const { data: poiRow } = await supabase
        .from("professional_pois")
        .select("id, latitude, longitude")
        .eq("type", "airport")
        .eq("code", String(listing.airport_code).trim().toUpperCase())
        .maybeSingle();
      if (poiRow) {
        poi = poiRow;
        if ((listing as any).primary_poi_id !== poiRow.id) {
          await supabase.from("listings").update({ primary_poi_id: poiRow.id }).eq("id", listingId);
        }
      }
    }

    if (!poi && (listing as any).primary_poi_id) {
      const { data: poiRow } = await supabase
        .from("professional_pois")
        .select("id, latitude, longitude")
        .eq("id", (listing as any).primary_poi_id)
        .maybeSingle();
      poi = poiRow ?? null;
    }

    if (!poi) {
      return res.status(400).json({ ok: false, error: "No airport reference point for this listing." });
    }

    // Skip repeat work: never inside the cooldown, and not while a result is still fresh unless forced.
    const { data: existing } = await supabase
      .from("listing_transport_summaries")
      .select("updated_at")
      .eq("listing_id", listingId)
      .eq("poi_id", poi.id)
      .maybeSingle();
    const lastUpdated = existing?.updated_at ? new Date(existing.updated_at).getTime() : null;
    if (lastUpdated != null && Number.isFinite(lastUpdated)) {
      const age = Date.now() - lastUpdated;
      if (age < REFRESH_COOLDOWN_MS) return res.status(200).json({ ok: true, skipped: "cooldown" });
      if (!force && age < FRESH_FOR_MS) return res.status(200).json({ ok: true, skipped: "fresh" });
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
      early: getNextOffPeakTimestamp(EARLY_DEPARTURE_HOUR, timeZone),
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

    // Earliest public transport a guest could catch from about 04:00 (crew often report before 06:00).
    const fetchEarliestTransit = async () => {
      const results = await Promise.all(
        resolvedTransitTargets.map(async (target) => {
          try {
            const routes = await fetchDirections(origin, target.coords, "transit", {
              transitMode: target.transitMode,
              alternatives: true,
              departureTime: departureTimes.early,
            });
            return pickEarliestDeparture(routes);
          } catch (err) {
            console.warn("[transport] early transit lookup failed", target.label, err);
            return null;
          }
        })
      );
      return pickEarliestDeparture(
        results.filter(Boolean).map((route) => route as any)
      );
    };

    // Driving lookups must succeed (they throw on a Google error, so nothing is saved on a failed run);
    // transit lookups are allowed to come back empty.
    const [transitBestDay, transitBestEvening, transitEarliest, drivingRoutesDay, drivingRoutesEvening] =
      await Promise.all([
        fetchBestTransitForTime(departureTimes.day),
        fetchBestTransitForTime(departureTimes.evening),
        fetchEarliestTransit(),
        fetchDirections(origin, drivingTarget, "driving", { departureTime: departureTimes.day }),
        fetchDirections(origin, drivingTarget, "driving", { departureTime: departureTimes.evening }),
      ]);

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

    const nowIso = new Date().toISOString();
    const firstDeparture = firstDepartureLocal(transitEarliest?.legs?.[0], timeZone);

    // Only write what this run actually computed, so a transient failure (e.g. one transit lookup) can
    // never blank out a good value that is already saved.
    const payload: Record<string, unknown> = {
      listing_id: listingId,
      poi_id: poi.id,
      updated_at: nowIso,
    };
    if (transitTiming.typical != null) {
      payload.public_transport_duration_minutes = transitTiming.typical;
      payload.public_transport_typical_minutes = transitTiming.typical;
      payload.public_transport_buffer_minutes = transitTiming.buffer;
      payload.public_transport_transfers = transitMetaSummary.transfers;
      payload.public_transport_modes = transitMetaSummary.modes;
      payload.public_transport_updated_at = nowIso;
    }
    if (drivingTiming.typical != null) {
      payload.taxi_duration_minutes = drivingTiming.typical;
      payload.taxi_typical_minutes = drivingTiming.typical;
      payload.taxi_buffer_minutes = drivingTiming.buffer;
      payload.taxi_distance_km = drivingDistanceKm;
      payload.taxi_cost_min = taxiEstimate.min;
      payload.taxi_cost_max = taxiEstimate.max;
      payload.taxi_updated_at = nowIso;
    }
    if (firstDeparture) {
      payload.public_transport_first_departure = firstDeparture;
    }

    const save = (row: Record<string, unknown>) =>
      supabase.from("listing_transport_summaries").upsert(row, { onConflict: "listing_id,poi_id" });

    let { error: upsertError } = await save(payload);
    if (upsertError && isMissingColumnError(upsertError) && "public_transport_first_departure" in payload) {
      // The first-departure column comes from a newer migration; save the rest until it is applied.
      const { public_transport_first_departure: _omit, ...withoutNewColumn } = payload;
      ({ error: upsertError } = await save(withoutNewColumn));
    }

    if (upsertError) {
      console.error("[api/transport/refresh] save failed", upsertError);
      return res.status(500).json({ ok: false, error: "Could not save travel times." });
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[api/transport/refresh]", err);
    // Google/config errors can mention keys and project details, so the client only gets a generic message.
    return res.status(502).json({ ok: false, error: "Travel times are temporarily unavailable." });
  }
}
