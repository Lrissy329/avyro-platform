const PAID_FINAL_BOOKING_STATUSES = new Set(["paid", "confirmed", "completed"]);

export const normalizeBookingStatusKey = (status?: string | null) =>
  String(status ?? "").toLowerCase();

export const isPaidFinalBookingStatus = (status?: string | null) =>
  PAID_FINAL_BOOKING_STATUSES.has(normalizeBookingStatusKey(status));
