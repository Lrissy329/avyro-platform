export type GuestBookingStatus =
  | "pending"
  | "awaiting_payment"
  | "approved"
  | "paid"
  | "confirmed"
  | "completed"
  | "payment_failed"
  | "declined"
  | "cancelled"
  | "refunded"
  | string;

export type GuestBookingRecord = {
  id: string;
  listing_id: string;
  host_id: string | null;
  status: GuestBookingStatus;
  booking_type?: string | null;
  shared_group_id?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  guests_total?: number | null;
  guest_total_pence?: number | null;
  price_total?: number | null;
  currency?: string | null;
  stripe_status?: string | null;
  flex_mode?: "none" | "extra_night" | "rolling" | string | null;
  flex_status?: "inactive" | "active" | "ended" | "released" | "expired" | string | null;
  flex_min_nights?: number | null;
  flex_max_nights?: number | null;
  flex_current_confirmed_end?: string | null;
  flex_max_end?: string | null;
  flex_rolling_window_days?: number | null;
  flex_pricing_multiplier?: number | null;
  flex_extension_cutoff_at?: string | null;
  flex_extra_night?: boolean | null;
  flex_extra_night_status?: string | null;
  flex_extra_night_price_pence?: number | null;
  flex_extra_night_cutoff_at?: string | null;
  created_at?: string | null;
};

export type GuestListingRecord = {
  id: string;
  title: string | null;
  location: string | null;
  is_shared_stay?: boolean | null;
  shared_total_spots?: number | null;
  shared_weekly_price_pence?: number | null;
  address?: string | null;
  check_in_instructions?: string | null;
  check_out_instructions?: string | null;
  house_rules?: string | null;
};

export type GuestHostRecord = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type ReviewEligibility = {
  canGuestReview: boolean;
  canHostReview: boolean;
  guestAlreadyReviewed: boolean;
  hostAlreadyReviewed: boolean;
  reviewWindowExpiresAt: string | null;
};

export type GuestBookingBuckets = {
  current: GuestBookingRecord[];
  upcoming: GuestBookingRecord[];
  past: GuestBookingRecord[];
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  awaiting_payment: "Awaiting payment",
  approved: "Awaiting payment",
  paid: "Paid",
  confirmed: "Confirmed",
  completed: "Completed",
  payment_failed: "Payment failed",
  declined: "Declined",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const statusStyles: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600 border-slate-200",
  awaiting_payment: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-slate-100 text-slate-600 border-slate-200",
  payment_failed: "bg-rose-50 text-rose-700 border-rose-200",
  declined: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
  refunded: "bg-rose-50 text-rose-700 border-rose-200",
};

export const resolvePaymentStatus = (
  status?: string | null,
  stripeStatus?: string | null
): string => {
  const key = String(status ?? "").toLowerCase();
  const stripeKey = String(stripeStatus ?? "").toLowerCase();
  const hasPaidStripeState = ["paid", "succeeded", "complete"].includes(stripeKey);

  if (hasPaidStripeState) {
    if (key === "confirmed" || key === "completed") return key;
    return "paid";
  }

  return key;
};

export const isMissingColumnError = (error: any) => {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

export const parseIsoDate = (value?: string | null): Date | null => {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export const resolveBookingCheckIn = (booking: GuestBookingRecord): string | null =>
  booking.check_in_time ?? booking.check_in ?? null;

export const resolveBookingCheckOut = (booking: GuestBookingRecord): string | null =>
  booking.check_out_time ?? booking.check_out ?? null;

export const sortBookingsByCheckIn = (bookings: GuestBookingRecord[]): GuestBookingRecord[] => {
  return [...bookings].sort((a, b) => {
    const aTime = parseIsoDate(resolveBookingCheckIn(a))?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = parseIsoDate(resolveBookingCheckIn(b))?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
};

export const groupGuestBookings = (
  bookings: GuestBookingRecord[],
  now = new Date()
): GuestBookingBuckets => {
  const current: GuestBookingRecord[] = [];
  const upcoming: GuestBookingRecord[] = [];
  const past: GuestBookingRecord[] = [];

  const sorted = sortBookingsByCheckIn(bookings);

  sorted.forEach((booking) => {
    const checkIn = parseIsoDate(resolveBookingCheckIn(booking));
    const checkOut = parseIsoDate(resolveBookingCheckOut(booking));

    if (checkIn && checkOut && now >= checkIn && now < checkOut) {
      current.push(booking);
      return;
    }

    if (checkIn && checkIn > now) {
      upcoming.push(booking);
      return;
    }

    if (checkOut && checkOut <= now) {
      past.push(booking);
      return;
    }

    upcoming.push(booking);
  });

  return { current, upcoming, past };
};

export const statusLabel = (status?: string | null, stripeStatus?: string | null): string => {
  const key = resolvePaymentStatus(status, stripeStatus);
  return statusLabels[key] ?? (key ? key.replace(/_/g, " ") : "Unknown");
};

export const statusClassName = (status?: string | null, stripeStatus?: string | null): string => {
  const key = resolvePaymentStatus(status, stripeStatus);
  return statusStyles[key] ?? "bg-slate-100 text-slate-600 border-slate-200";
};

export const formatDate = (value?: string | null): string => {
  const date = parseIsoDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const formatDateRange = (checkIn?: string | null, checkOut?: string | null): string => {
  const start = parseIsoDate(checkIn);
  const end = parseIsoDate(checkOut);
  if (!start || !end) return "Dates pending";
  const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return `${dateFmt.format(start)} → ${dateFmt.format(end)}`;
};

export const bookingNights = (booking: GuestBookingRecord): number | null => {
  const start = parseIsoDate(resolveBookingCheckIn(booking));
  const end = parseIsoDate(resolveBookingCheckOut(booking));
  if (!start || !end) return null;
  const diff = end.getTime() - start.getTime();
  if (diff <= 0) return null;
  return Math.ceil(diff / 86400000);
};

export const bookingReference = (bookingId?: string | null): string => {
  if (!bookingId) return "—";
  return `BK-${bookingId.slice(-6).toUpperCase()}`;
};

export const isAddressCopyAllowed = (status?: string | null, stripeStatus?: string | null) => {
  const key = resolvePaymentStatus(status, stripeStatus);
  return key === "confirmed" || key === "paid" || key === "completed";
};

export const isAwaitingPayment = (status?: string | null, stripeStatus?: string | null) => {
  const key = resolvePaymentStatus(status, stripeStatus);
  return key === "awaiting_payment" || key === "approved" || key === "payment_failed";
};

export const canGuestCancel = (status?: string | null, stripeStatus?: string | null) => {
  const key = resolvePaymentStatus(status, stripeStatus);
  return (
    key === "pending" ||
    key === "awaiting_payment" ||
    key === "approved" ||
    key === "confirmed" ||
    key === "paid"
  );
};
