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
