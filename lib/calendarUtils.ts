import {
  CalendarEvent,
  DayState,
  LinearCalendarEvent,
  LinearCalendarSource,
  ParsedIcalEvent,
} from "./calendarTypes";

export function parseISODate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function eventCoversDate(event: CalendarEvent, date: Date): boolean {
  const start = parseISODate(event.startDate);
  const end = parseISODate(event.endDate);
  return start <= date && date < end;
}

export function resolveDayState(events: CalendarEvent[]): DayState {
  if (!events.length) return "free";

  const hasDirectConfirmed = events.some(
    (e) =>
      e.channel === "direct" && e.kind === "booking" && e.status === "confirmed"
  );

  const hasDirectPending = events.some(
    (e) =>
      e.channel === "direct" && e.kind === "booking" && e.status === "pending"
  );

  const hasBlocked = events.some((e) => e.channel === "blocked" || e.kind === "block");

  const hasExternal = events.some((e) => ["airbnb", "vrbo", "other"].includes(e.channel));

  const occupancyBuckets =
    (hasDirectConfirmed ? 1 : 0) +
    (hasDirectPending ? 1 : 0) +
    (hasBlocked ? 1 : 0) +
    (hasExternal ? 1 : 0);

  if (occupancyBuckets > 1) return "conflict";
  if (hasDirectConfirmed) return "direct_confirmed";
  if (hasDirectPending) return "direct_pending";
  if (hasBlocked) return "blocked";
  if (hasExternal) return "external";

  return "free";
}

export function mapIcalEventToLinearCalendar(
  raw: ParsedIcalEvent,
  listingId: string,
  source: LinearCalendarSource
): LinearCalendarEvent {
  const start = raw.start;
  const end = raw.end;

  return {
    id: raw.uid ?? `${source}-${start.toISOString()}`,
    listingId,
    start,
    end,
    label: raw.summary || `${source} booking`,
    color: "#000000",
    source,
    meta: {
      status: "paid",
      nights: raw.nights ?? undefined,
      total: null,
      currency: null,
      externalUrl: raw.url ?? null,
    },
  };
}
