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
        guestName: block.reason?.trim() || "Blocked",
        start: block.start,
        end: block.end,
        channel: "manual",
        status: "blocked",
        address: listingById[block.listingId]?.address,
        isBlock: true,
        bookingType: block.blockType,
      };

      return {
        id: eventId,
        text: "Blocked",
        start,
        end,
        backColor: "#94a3b8",
        borderColor: "rgba(51,65,85,0.35)",
        fontColor: "#0f172a",
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
