import type { BookingStayType, BookingChannel } from "@/lib/calendarTypes";

/**
 * Payload used by client → API when creating a booking.
 * Times must be passed in ISO 8601 UTC format (e.g. "2025-03-10T06:00:00Z").
 */
export interface CreateBookingPayload {
  listingId: string;
  guestId: string;

  checkInTime: string;
  checkOutTime: string;
  stayType: BookingStayType;
  channel: BookingChannel;

  guests?: number;
}
