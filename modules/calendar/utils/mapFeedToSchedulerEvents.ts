import { getChannelMeta } from "@/lib/calendarChannel";
import { addDays, formatLocalDate } from "@/lib/dateUtils";
import type {
  CalendarFeed,
  CalendarFeedBooking,
  CalendarFeedListing,
  ReservationRecord,
  SchedulerEventMapResult,
} from "@/modules/calendar/types";

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

const toDateOnly = (iso: string) => formatLocalDate(new Date(iso));

const isNightlyBooking = (booking: CalendarFeedBooking) => booking.bookingType !== "hourly";

const normalizeChannel = (channel?: string | null) => {
  const value = String(channel ?? "direct").toLowerCase();
  if (value === "booking") return "bookingcom";
  return value;
};

const channelClassName = (channel: string) => {
  if (channel === "bookingcom" || channel === "booking") return "booking";
  if (channel === "airbnb") return "airbnb";
  if (channel === "vrbo") return "vrbo";
  if (channel === "expedia") return "expedia";
  if (channel === "manual") return "manual";
  if (channel === "other") return "other";
  return "direct";
};

const listingMap = (listings: CalendarFeedListing[]) =>
  listings.reduce<Record<string, CalendarFeedListing>>((acc, listing) => {
    acc[listing.id] = listing;
    return acc;
  }, {});

const toReservationRecord = (
  listingById: Record<string, CalendarFeedListing>,
  booking: CalendarFeedBooking
): ReservationRecord => ({
  id: booking.id,
  listingId: booking.listingId,
  listingTitle: listingById[booking.listingId]?.title ?? "Listing",
  guestName: booking.guestName,
  start: booking.start,
  end: booking.end,
  channel: String(booking.channel ?? "direct"),
  status: String(booking.status ?? "confirmed"),
  totalPence: booking.totalPence,
  payoutEstimatePence: booking.payoutEstimatePence,
  currency: booking.currency,
  address: listingById[booking.listingId]?.address,
  bookingType: booking.bookingType,
  flexMode: booking.flexMode ?? null,
  flexCurrentConfirmedEnd: booking.flexCurrentConfirmedEnd ?? null,
  flexMaxEnd: booking.flexMaxEnd ?? null,
  flexExtensionCutoffAt: booking.flexExtensionCutoffAt ?? null,
  flexExtraNight: booking.flexExtraNight,
  flexExtraNightStatus: booking.flexExtraNightStatus ?? null,
  flexExtraNightPricePence: booking.flexExtraNightPricePence ?? null,
  isBlock: false,
});

export function mapFeedToSchedulerEvents(feed: CalendarFeed): SchedulerEventMapResult {
  const listingById = listingMap(feed.listings);
  const reservationsByEventId: Record<string, ReservationRecord> = {};
  const cellStatesByListingDate: Record<string, "booked" | "blocked"> = {};

  const bookingEvents = feed.bookings
    .filter((booking) => booking.listingId && booking.start && booking.end)
    .filter(isNightlyBooking)
    .map((booking) => {
      const channel = normalizeChannel(booking.channel);
      const eventId = `booking-${booking.id}`;
      const start = toDateOnly(booking.start);
      const end = toDateOnly(booking.end);
      const reservation = toReservationRecord(listingById, booking);
      reservationsByEventId[eventId] = reservation;

      const eventStart = new Date(`${start}T00:00:00`);
      const eventEnd = new Date(`${end}T00:00:00`);
      for (let cursor = new Date(eventStart); cursor < eventEnd; cursor = addDays(cursor, 1)) {
        cellStatesByListingDate[`${booking.listingId}::${formatLocalDate(cursor)}`] = "booked";
      }

      const channelMeta = getChannelMeta(channel as any, { isBlock: false });
      const isCancelled = String(booking.status ?? "").toLowerCase() === "cancelled";

      return {
        id: eventId,
        resource: booking.listingId,
        text: firstName(booking.guestName),
        start,
        end,
        toolTip: `${escapeHtml(firstName(booking.guestName))} · ${escapeHtml(start)} - ${escapeHtml(end)}`,
        tags: {
          reservationId: booking.id,
          kind: "booking",
          channel,
          status: booking.status,
        },
        backColor: isCancelled ? "#cbd5e1" : COLOR_BY_CHANNEL[channel] ?? COLOR_BY_CHANNEL.direct,
        borderColor: "rgba(15,23,42,0.20)",
        fontColor: isCancelled ? "#334155" : "#ffffff",
        cssClass: `avyro-dp-event avyro-dp-event--channel-${channelClassName(channel)}`,
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
    .filter((block) => block.listingId && block.start && block.end)
    .map((block) => {
      const isOptionalFlex = block.blockType === "flex_optional";
      const isRollingFlexHold = block.blockType === "flex_rolling_held";
      const isSharedGroup = block.blockType === "shared_group";
      const eventId = `block-${block.id}`;
      const start = toDateOnly(block.start);
      const end = toDateOnly(block.end);
      const sharedOccupied =
        (block.sharedFilledSpots ?? 0) + (block.sharedPendingSpots ?? 0);
      const sharedLabel = isSharedGroup
        ? `Shared stay ${sharedOccupied}/${block.sharedTotalSpots ?? 0} filled`
        : null;

      reservationsByEventId[eventId] = {
        id: block.id,
        listingId: block.listingId,
        listingTitle: listingById[block.listingId]?.title ?? "Listing",
        guestName: isSharedGroup
          ? "Shared crew stay"
          : isRollingFlexHold
          ? "Flex hold"
          : block.reason?.trim() || "Blocked",
        start: block.start,
        end: block.end,
        channel: "manual",
        status: isSharedGroup ? "shared" : isRollingFlexHold ? "reserved" : "blocked",
        address: listingById[block.listingId]?.address,
        isBlock: true,
        bookingType: "nightly",
        flexMode: isRollingFlexHold ? "rolling" : null,
        flexCurrentConfirmedEnd: isRollingFlexHold ? block.confirmedEnd ?? null : null,
        flexMaxEnd: isRollingFlexHold ? block.maxEnd ?? null : null,
        flexExtensionCutoffAt: isRollingFlexHold ? block.cutoffAt ?? null : null,
        sharedGroupId: isSharedGroup ? block.sharedGroupId ?? null : null,
        sharedTotalSpots: isSharedGroup ? block.sharedTotalSpots ?? null : null,
        sharedFilledSpots: isSharedGroup ? block.sharedFilledSpots ?? null : null,
        sharedPendingSpots: isSharedGroup ? block.sharedPendingSpots ?? null : null,
      };

      const eventStart = new Date(`${start}T00:00:00`);
      const eventEnd = new Date(`${end}T00:00:00`);
      for (let cursor = new Date(eventStart); cursor < eventEnd; cursor = addDays(cursor, 1)) {
        cellStatesByListingDate[`${block.listingId}::${formatLocalDate(cursor)}`] = "blocked";
      }

      const channelMeta = getChannelMeta("manual" as any, { isBlock: true });

      return {
        id: eventId,
        resource: block.listingId,
        text: isSharedGroup
          ? sharedLabel ?? "Shared group"
          : isRollingFlexHold
          ? "Flex hold"
          : isOptionalFlex
          ? "Optional night"
          : "Blocked",
        start,
        end,
        tags: {
          reservationId: block.id,
          kind: "block",
          channel: "manual",
          status: isSharedGroup
            ? "shared"
            : isOptionalFlex || isRollingFlexHold
            ? "reserved"
            : "blocked",
        },
        backColor: isSharedGroup
          ? "#fef9c3"
          : isRollingFlexHold
          ? "#e8eef9"
          : isOptionalFlex
          ? "#e2e8f0"
          : "#94a3b8",
        borderColor: isRollingFlexHold
          ? "rgba(37,99,235,0.55)"
          : isSharedGroup
          ? "rgba(202,138,4,0.45)"
          : isOptionalFlex
          ? "rgba(100,116,139,0.55)"
          : "rgba(51,65,85,0.35)",
        fontColor: isSharedGroup ? "#78350f" : "#0f172a",
        cssClass: `avyro-dp-event avyro-dp-event--channel-block${
          isOptionalFlex ? " avyro-dp-event--optional-night" : ""
        }${isRollingFlexHold ? " avyro-dp-event--rolling-hold" : ""}${
          isRollingFlexHold ? " avyro-dp-event--optional-night" : ""
        }${isSharedGroup ? " avyro-dp-event--shared-group" : ""}`,
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
    cellStatesByListingDate,
  };
}
