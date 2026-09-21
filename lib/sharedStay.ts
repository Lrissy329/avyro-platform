import { differenceInCalendarDays } from "date-fns";

// Matches the Stripe Checkout Session expires_at set in
// pages/api/shared-groups/checkout.ts (30 minutes) so the capacity hold
// and the payment window always expire together -- a guest who pays
// inside the window must not find their spot already released to
// someone else.
export const SHARED_GROUP_PENDING_HOLD_MINUTES = 30;

export const parseIsoDateOnly = (value?: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
};

export const toIsoDateOnly = (date: Date) => date.toISOString().slice(0, 10);

export const getSharedStayWeeks = (checkIn: string, checkOut: string) => {
  const checkInDate = parseIsoDateOnly(checkIn);
  const checkOutDate = parseIsoDateOnly(checkOut);
  if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
    return { valid: false, weeks: 0, nights: 0 };
  }

  const nights = differenceInCalendarDays(checkOutDate, checkInDate);
  if (nights < 7 || nights % 7 !== 0) {
    return { valid: false, weeks: 0, nights };
  }

  return {
    valid: true,
    weeks: nights / 7,
    nights,
  };
};

export const addMinutesIso = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

export const normalizeSharedJoinMode = (value?: string | null): "open" | "approval" => {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "approval" ? "approval" : "open";
};
