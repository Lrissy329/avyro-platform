import { formatLocalDate } from "@/lib/dateUtils";
import type { CalendarFeed, CalendarFeedListing, EventMapResult, ReservationRecord } from "@/modules/calendar/types";

const firstName = (value?: string | null) => {
  const clean = value?.trim();
  if (!clean) return "Guest";
  const [first] = clean.split(/\s+/);
  return first || "Guest";
};

const COLOR_BY_CHANNEL: Record<string, string> = {
  direct: "#0f172a",
  booking: "#1d4ed8",
  bookingcom: "#1d4ed8",
  airbnb: "#ef4444",
  vrbo: "#2563eb",
  expedia: "#0f766e",
  manual: "#64748b",
  other: "#475569",
};

const listingMap = (listings: CalendarFeedListing[]) =>
  listings.reduce<Record<string, CalendarFeedListing>>((acc, listing) => {
    acc[listing.id] = listing;
    return acc;
  }, {});

const dateOnly = (iso: string) => formatLocalDate(new Date(iso));

export function mapFeedToMonthEvents(feed: CalendarFeed): EventMapResult {
  const listingById = listingMap(feed.listings);
  const reservationsByEventId: Record<string, ReservationRecord> = {};

  const bookingEvents = feed.bookings
    .filter((booking) => booking.listingId && booking.start && booking.end)
    .map((booking) => {
      const eventId = `booking-${booking.id}`;
      const channel = String(booking.channel ?? "direct").toLowerCase();
      const isNightly = booking.bookingType !== "hourly";
      const start = isNightly ? dateOnly(booking.start) : booking.start;
      const end = isNightly ? dateOnly(booking.end) : booking.end;

      reservationsByEventId[eventId] = {
        id: booking.id,
        listingId: booking.listingId,
        listingTitle: listingById[booking.listingId]?.title ?? "Listing",
        guestName: booking.guestName,
        start: booking.start,
        end: booking.end,
        channel: booking.channel,
        status: booking.status,
        totalPence: booking.totalPence,
        payoutEstimatePence: booking.payoutEstimatePence,
        currency: booking.currency,
        address: listingById[booking.listingId]?.address,
        bookingType: booking.bookingType,
        flexMode: booking.flexMode ?? null,
        flexCurrentConfirmedEnd: booking.flexCurrentConfirmedEnd ?? null,
        flexMaxEnd: booking.flexMaxEnd ?? null,
        flexExtensionCutoffAt: booking.flexExtensionCutoffAt ?? null,
        flexExtraNight: booking.flexExtraNight ?? null,
        flexExtraNightStatus: booking.flexExtraNightStatus ?? null,
        flexExtraNightPricePence: booking.flexExtraNightPricePence ?? null,
        isBlock: false,
      };

      return {
        id: eventId,
        text: firstName(booking.guestName),
        start,
        end,
        backColor:
          String(booking.status ?? "").toLowerCase() === "cancelled"
            ? "#cbd5e1"
            : COLOR_BY_CHANNEL[channel] ?? COLOR_BY_CHANNEL.direct,
        borderColor: "rgba(15,23,42,0.2)",
        fontColor:
          String(booking.status ?? "").toLowerCase() === "cancelled" ? "#334155" : "#ffffff",
        tags: {
          reservationId: booking.id,
          listingId: booking.listingId,
          kind: "booking",
        },
      };
    });

  const blockEvents = feed.blocks
    .filter((block) => block.listingId && block.start && block.end)
    .map((block) => {
      const eventId = `block-${block.id}`;
      const start = block.blockType === "hourly" ? block.start : dateOnly(block.start);
      const end = block.blockType === "hourly" ? block.end : dateOnly(block.end);

      reservationsByEventId[eventId] = {
        id: block.id,
        listingId: block.listingId,
        listingTitle: listingById[block.listingId]?.title ?? "Listing",
        guestName:
          block.blockType === "shared_group"
            ? "Shared stay"
            : block.blockType === "flex_rolling_held"
            ? "Flex hold"
            : block.reason?.trim() || "Blocked",
        start: block.start,
        end: block.end,
        channel: "manual",
        status:
          block.blockType === "shared_group"
            ? "shared"
            : block.blockType === "flex_rolling_held"
            ? "reserved"
            : "blocked",
        address: listingById[block.listingId]?.address,
        isBlock: true,
        bookingType: block.blockType === "hourly" ? "hourly" : "nightly",
        flexMode: block.blockType === "flex_rolling_held" ? "rolling" : null,
        flexCurrentConfirmedEnd: block.confirmedEnd ?? null,
        flexMaxEnd: block.maxEnd ?? null,
        flexExtensionCutoffAt: block.cutoffAt ?? null,
        sharedGroupId: block.blockType === "shared_group" ? block.sharedGroupId ?? null : null,
        sharedTotalSpots: block.blockType === "shared_group" ? block.sharedTotalSpots ?? null : null,
        sharedFilledSpots: block.blockType === "shared_group" ? block.sharedFilledSpots ?? null : null,
        sharedPendingSpots: block.blockType === "shared_group" ? block.sharedPendingSpots ?? null : null,
      };

      return {
        id: eventId,
        text:
          block.blockType === "shared_group"
            ? `Shared stay ${(block.sharedFilledSpots ?? 0) + (block.sharedPendingSpots ?? 0)}/${
                block.sharedTotalSpots ?? 0
              } filled`
            : block.blockType === "flex_rolling_held"
            ? "Flex hold"
            : "Blocked",
        start,
        end,
        backColor:
          block.blockType === "shared_group"
            ? "#fef9c3"
            : block.blockType === "flex_rolling_held"
            ? "#e8eef9"
            : "#94a3b8",
        borderColor:
          block.blockType === "shared_group"
            ? "rgba(202,138,4,0.45)"
            : block.blockType === "flex_rolling_held"
            ? "rgba(37,99,235,0.55)"
            : "rgba(51,65,85,0.35)",
        fontColor: block.blockType === "shared_group" ? "#78350f" : "#0f172a",
        tags: {
          reservationId: block.id,
          listingId: block.listingId,
          kind: "block",
        },
      };
    });

  return {
    events: [...bookingEvents, ...blockEvents],
    reservationsByEventId,
  };
}
