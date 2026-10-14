// Pure helpers for the airport travel-time feature (pages/api/transport/refresh.ts and the listing card).
// No imports, so they can be unit-tested in isolation.

/**
 * Seconds for one driving leg. Google returns `duration` (no traffic) and, when a departure_time was sent,
 * `duration_in_traffic` (its traffic model for that time). Use the traffic-aware figure when present.
 */
export const drivingLegSeconds = (leg: any): number | null => {
  const inTraffic = leg?.duration_in_traffic?.value;
  if (Number.isFinite(inTraffic) && inTraffic > 0) return inTraffic;
  const plain = leg?.duration?.value;
  return Number.isFinite(plain) && plain > 0 ? plain : null;
};

/**
 * Earliest public-transport departure Google found for a trip requested from `requestedAtEpoch`, as "HH:MM"
 * in the stop's own time zone. Returns null when there is no route.
 */
export const firstDepartureLocal = (leg: any, fallbackTimeZone = "Europe/London"): string | null => {
  const value = leg?.departure_time?.value;
  if (!Number.isFinite(value)) return null;
  const timeZone = typeof leg?.departure_time?.time_zone === "string" ? leg.departure_time.time_zone : fallbackTimeZone;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value * 1000));
  } catch {
    return null;
  }
};

export type TransportKind = "bus" | "train" | "mixed";

const RAIL_TYPES = new Set([
  "RAIL",
  "HEAVY_RAIL",
  "COMMUTER_TRAIN",
  "HIGH_SPEED_TRAIN",
  "LONG_DISTANCE_TRAIN",
  "SUBWAY",
  "METRO_RAIL",
  "MONORAIL",
  "TRAM",
  "LIGHT_RAIL",
]);
const BUS_TYPES = new Set(["BUS", "INTERCITY_BUS", "TROLLEYBUS", "SHARE_TAXI"]);

/** Google vehicle types -> what a guest would call it. Unknown types return null. */
export const classifyTransitModes = (modes?: string[] | null): TransportKind | null => {
  const upper = (modes ?? []).map((mode) => String(mode ?? "").trim().toUpperCase()).filter(Boolean);
  if (upper.length === 0) return null;
  const hasBus = upper.some((mode) => BUS_TYPES.has(mode));
  const hasRail = upper.some((mode) => RAIL_TYPES.has(mode));
  if (hasBus && hasRail) return "mixed";
  if (hasBus) return "bus";
  if (hasRail) return "train";
  return null;
};

/** True for a plain "HH:MM" 24-hour clock string (what firstDepartureLocal returns). */
export const isValidClockTime = (value: unknown): value is string =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/**
 * Decodes a Google Directions "overview_polyline.points" string into [lng, lat] pairs (GeoJSON/
 * Mapbox coordinate order, not Google's [lat, lng]). Standard encoded-polyline algorithm --
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm -- reimplemented
 * here rather than pulled in as a dependency since it is ~15 lines with no external state.
 */
export const decodePolyline = (encoded: string): [number, number][] => {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates;
};
