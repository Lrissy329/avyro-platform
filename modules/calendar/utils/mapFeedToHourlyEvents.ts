import { getChannelMeta } from "@/lib/calendarChannel";
import type { CalendarFeed, CalendarFeedListing, ReservationRecord, EventMapResult } from "@/modules/calendar/types";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

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

const normalizeChannel = (channel?: string | null) => {
  const value = String(channel ?? "direct").toLowerCase();
  if (value === "booking") return "bookingcom";
  return value;
};

const listingMap = (listings: CalendarFeedListing[]) =>
  listings.reduce<Record<string, CalendarFeedListing>>((acc, listing) => {
    acc[listing.id] = listing;
    return acc;
  }, {});

export function mapFeedToHourlyEvents(feed: CalendarFeed): EventMapResult {
  const reservationsByEventId: Record<string, ReservationRecord> = {};
  const listingById = listingMap(feed.listings);

  const bookingEvents = feed.bookings
    .filter((booking) => booking.bookingType === "hourly")
    .map((booking) => {
      const channel = normalizeChannel(booking.channel);
      const eventId = `booking-${booking.id}`;
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
        bookingType: "hourly",
        flexMode: booking.flexMode ?? null,
        flexCurrentConfirmedEnd: booking.flexCurrentConfirmedEnd ?? null,
        flexMaxEnd: booking.flexMaxEnd ?? null,
        flexExtensionCutoffAt: booking.flexExtensionCutoffAt ?? null,
        flexExtraNight: booking.flexExtraNight ?? null,
        flexExtraNightStatus: booking.flexExtraNightStatus ?? null,
        flexExtraNightPricePence: booking.flexExtraNightPricePence ?? null,
        isBlock: false,
      };

      const channelMeta = getChannelMeta(channel as any, { isBlock: false });
      const isCancelled = String(booking.status ?? "").toLowerCase() === "cancelled";

      return {
        id: eventId,
        resource: booking.listingId,
        text: firstName(booking.guestName),
        start: booking.start,
        end: booking.end,
        toolTip: `${escapeHtml(firstName(booking.guestName))}`,
        tags: {
          reservationId: booking.id,
          kind: "booking",
          channel,
          status: booking.status,
        },
        backColor: isCancelled ? "#cbd5e1" : COLOR_BY_CHANNEL[channel] ?? COLOR_BY_CHANNEL.direct,
        borderColor: "rgba(15,23,42,0.20)",
        fontColor: isCancelled ? "#334155" : "#ffffff",
        cssClass: "avyro-dp-event",
        areas: [
          {
            right: 8,
            top: 6,
            width: 18,
            height: 18,
            cssClass: "avyro-dp-event-badge",
            html: `<span class=\"avyro-dp-event-badge__inner\"><img src=\"${escapeHtml(
              channelMeta.badgeIcon
            )}\" alt=\"\" width=\"12\" height=\"12\"/></span>`,
          },
        ],
      };
    });

  const blockEvents = feed.blocks
    .filter((block) => block.blockType === "hourly")
    .map((block) => {
      const eventId = `block-${block.id}`;
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
        bookingType: "hourly",
        isBlock: true,
      };

      const channelMeta = getChannelMeta("manual" as any, { isBlock: true });
      return {
        id: eventId,
        resource: block.listingId,
        text: "Blocked",
        start: block.start,
        end: block.end,
        tags: {
          reservationId: block.id,
          kind: "block",
          channel: "manual",
          status: "blocked",
        },
        backColor: "#94a3b8",
        borderColor: "rgba(51,65,85,0.35)",
        fontColor: "#0f172a",
        cssClass: "avyro-dp-event",
        areas: [
          {
            right: 8,
            top: 6,
            width: 18,
            height: 18,
            cssClass: "avyro-dp-event-badge",
            html: `<span class=\"avyro-dp-event-badge__inner\"><img src=\"${escapeHtml(
              channelMeta.badgeIcon
            )}\" alt=\"\" width=\"12\" height=\"12\"/></span>`,
          },
        ],
      };
    });

  return {
    events: [...bookingEvents, ...blockEvents],
    reservationsByEventId,
  };
}
