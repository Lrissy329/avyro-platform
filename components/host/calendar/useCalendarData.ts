import { useMemo } from "react";
import type { LinearCalendarEvent, LinearCalendarListing } from "@/components/calendar/LinearCalendar";
import { formatLocalDate, startOfDay } from "@/lib/dateUtils";
import type { CalendarChannel, ReservationStatus } from "./calendarStyles";

export type CalendarListing = {
  id: string;
  title: string;
  subtitle?: string;
};

export type CalendarReservation = {
  id: string;
  listingId: string;
  guestName: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // exclusive
  channel: CalendarChannel;
  status: ReservationStatus;
  totalPence?: number;
  currency?: string;
  payoutEstimatePence?: number;
  addressLine?: string;
};

type CalendarDataInput = {
  listings: LinearCalendarListing[];
  events: LinearCalendarEvent[];
  listingLocations?: Record<string, string | null>;
};

const normalizeChannel = (source: string | null | undefined): CalendarChannel => {
  switch ((source ?? "").toLowerCase()) {
    case "airbnb":
      return "airbnb";
    case "vrbo":
      return "vrbo";
    case "bookingcom":
      return "booking";
    case "expedia":
      return "expedia";
    case "manual":
      return "manual";
    case "other":
      return "other";
    case "booking":
    default:
      return "direct";
  }
};

const normalizeStatus = (status?: string | null): ReservationStatus => {
  switch ((status ?? "").toLowerCase()) {
    case "paid":
      return "paid";
    case "awaiting_payment":
    case "pending_payment":
      return "awaiting_payment";
    case "cancelled":
    case "declined":
    case "refunded":
      return "cancelled";
    default:
      return "confirmed";
  }
};

export function useCalendarData({ listings, events, listingLocations }: CalendarDataInput) {
  const normalizedListings = useMemo<CalendarListing[]>(() => {
    return (listings ?? []).map((listing) => ({
      id: listing.id,
      title: listing.name,
      subtitle: listingLocations?.[listing.id] ?? undefined,
    }));
  }, [listings, listingLocations]);

  const reservations = useMemo<CalendarReservation[]>(() => {
    return (events ?? []).map((event) => {
      const start = startOfDay(event.start);
      const end = startOfDay(event.end);
      const guestName = event.meta?.guestName ?? event.label ?? "Guest";
      const totalMajor = event.meta?.total;
      const totalPence =
        totalMajor == null || !Number.isFinite(Number(totalMajor))
          ? undefined
          : Math.round(Number(totalMajor) * 100);
      return {
        id: event.id,
        listingId: event.listingId,
        guestName,
        startDate: formatLocalDate(start),
        endDate: formatLocalDate(end),
        channel: normalizeChannel(event.source),
        status: normalizeStatus(event.meta?.status),
        totalPence,
        payoutEstimatePence: event.meta?.hostPayout ?? undefined,
        currency: event.meta?.currency ?? undefined,
        addressLine: listingLocations?.[event.listingId] ?? undefined,
      };
    });
  }, [events, listingLocations]);

  return { listings: normalizedListings, reservations };
}
