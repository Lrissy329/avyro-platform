import type { LinearCalendarEvent, BookingStatus, LinearCalendarSource } from "@/lib/calendarTypes";
import type { LinearCalendarListing } from "@/components/calendar/LinearCalendar";
import { addDays, diffInDays } from "@/lib/dateUtils";

type BookingRow = {
  id: string;
  listing_id: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  channel: string | null;
  status: BookingStatus | null;
  price_total: number | null;
  currency: string | null;
  guest_full_name?: string | null;
  stay_type?: string | null;
};

type CalendarBlockRow = {
  id: string;
  listing_id: string | null;
  start_date: string | null;
  end_date: string | null;
  source?: string | null;
  label?: string | null;
  color?: string | null;
  notes?: string | null;
};

const CHANNEL_COLORS: Record<string, string> = {
  direct: "#0f172a",
  manual: "#fb923c",
  airbnb: "#ff385c",
  vrbo: "#2563eb",
  bookingcom: "#2563eb",
  expedia: "#fcd34d",
  other: "#7c3aed",
};

const CHANNEL_TEXT: Record<string, string> = {
  direct: "Direct booking",
  manual: "Manual block",
  airbnb: "Airbnb",
  vrbo: "Vrbo",
  bookingcom: "Booking.com",
  expedia: "Expedia",
  other: "External",
};

const BLOCK_SOURCE_TEXT: Record<LinearCalendarSource, string> = {
  booking: "Blocked",
  manual: "Manual block",
  airbnb: "Airbnb iCal",
  vrbo: "Vrbo iCal",
  bookingcom: "Booking.com",
  expedia: "Expedia",
  other: "External block",
};

const mapChannelToSource = (channel: string | null | undefined): LinearCalendarSource => {
  switch ((channel ?? "direct").toLowerCase()) {
    case "airbnb":
      return "airbnb";
    case "vrbo":
      return "vrbo";
    case "bookingcom":
      return "bookingcom";
    case "expedia":
      return "expedia";
    case "manual":
      return "manual";
    case "other":
      return "other";
    default:
      return "booking";
  }
};

const normalizeBlockSource = (
  source: string | null | undefined,
  label: string | null | undefined
): LinearCalendarSource => {
  const normalized = (source ?? "").toLowerCase();
  if (normalized) {
    return mapChannelToSource(normalized);
  }
  const fallback = (label ?? "").toLowerCase();
  if (fallback.includes("airbnb")) return "airbnb";
  if (fallback.includes("vrbo")) return "vrbo";
  if (fallback.includes("booking")) return "bookingcom";
  if (fallback.includes("expedia")) return "expedia";
  return "manual";
};

const colorForChannel = (channel: string | null | undefined) => {
  const key = (channel ?? "direct").toLowerCase();
  return CHANNEL_COLORS[key] ?? CHANNEL_COLORS.direct;
};

const colorForSource = (source: LinearCalendarSource) => {
  if (source === "booking") return CHANNEL_COLORS.direct;
  return CHANNEL_COLORS[source] ?? CHANNEL_COLORS.direct;
};

export function mapHostBookingsToLinearEvents(
  listings: Array<{ id: string; title?: string | null }>,
  bookings: BookingRow[]
): LinearCalendarEvent[] {
  const listingNames = listings.reduce<Record<string, string>>((acc, listing) => {
    if (listing.id) {
      acc[listing.id] = listing.title?.trim() || "Listing";
    }
    return acc;
  }, {});

  return (bookings ?? [])
    .filter((booking) => booking.listing_id && booking.check_in_time && booking.check_out_time)
    .map<LinearCalendarEvent>((booking) => {
      const source = mapChannelToSource(booking.channel);
      const label =
        booking.guest_full_name?.trim() ||
        listingNames[booking.listing_id as string] ||
        "Booking";

      const meta: LinearCalendarEvent["meta"] = {
        kind: "booking",
        status: booking.status ?? undefined,
        total: booking.price_total ?? null,
        currency: booking.currency ?? "GBP",
        guestName: booking.guest_full_name ?? null,
        stayType: booking.stay_type ?? null,
      };

      return {
        id: booking.id,
        listingId: booking.listing_id as string,
        start: new Date(booking.check_in_time as string),
        end: new Date(booking.check_out_time as string),
        label,
        color: colorForChannel(booking.channel),
        textColor: "#ffffff",
        badgeLabel: CHANNEL_TEXT[(booking.channel ?? "direct").toLowerCase()] ?? "Booking",
        source,
        meta,
      };
    });
}

export function mapHostBlocksToLinearEvents(blocks: CalendarBlockRow[]): LinearCalendarEvent[] {
  return (blocks ?? [])
    .filter((block) => block.listing_id && block.start_date && block.end_date)
    .map<LinearCalendarEvent>((block) => {
      const source = normalizeBlockSource(block.source, block.label);
      const start = new Date(block.start_date as string);
      const endInclusive = new Date(block.end_date as string);
      const end = addDays(endInclusive, 1);
      const nights = Math.max(1, diffInDays(endInclusive, start) + 1);
      const label =
        block.label?.trim() ||
        (source === "manual" ? "Manual block" : "External block");

      const notes = block.notes ?? null;

      const isManualBlock = source === "manual";
      const blockColor = isManualBlock ? (block.color ?? colorForSource(source)) : "#e2e8f0";
      const blockTextColor = isManualBlock ? "#7c2d12" : "#475569";

      const meta: LinearCalendarEvent["meta"] = {
        kind: "block",
        reason: notes,
        notes,
        nights,
      };

      return {
        id: block.id,
        listingId: block.listing_id as string,
        start,
        end,
        label,
        color: blockColor,
        textColor: blockTextColor,
        badgeLabel: BLOCK_SOURCE_TEXT[source],
        source,
        meta,
      };
    });
}

export function listingsToLinearCalendar(
  listings: Array<{
    id: string;
    title?: string | null;
    booking_unit?: string | null;
    timezone?: string | null;
  }>
): LinearCalendarListing[] {
  return (listings ?? []).map((listing) => ({
    id: listing.id,
    name: listing.title?.trim() || "Listing",
    bookingUnit: (listing.booking_unit as "nightly" | "hourly" | null) ?? "nightly",
    timezone: listing.timezone ?? "Europe/London",
  }));
}
