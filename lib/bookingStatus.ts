const PAID_FINAL_BOOKING_STATUSES = new Set(["paid", "confirmed", "completed"]);
const STRIPE_PAID_STATUSES = new Set(["paid", "succeeded", "complete"]);
const SELF_CANCELLABLE_BOOKING_STATUSES = new Set([
  "pending",
  "awaiting_payment",
  "pending_payment",
  "approved",
]);
// Narrower than SELF_CANCELLABLE_BOOKING_STATUSES: only the literal
// pre-charge statuses the two Checkout-session-creating flows
// (pages/api/bookings/create.ts, pages/api/shared-groups/checkout.ts)
// actually insert. Used to positively identify "this row is still an
// unpaid provisional Checkout hold" for the checkout.session.expired
// webhook handler -- a positive allowlist, not "anything that isn't
// paid", so an unexpected/future/unknown status is never touched.
const CHECKOUT_PROVISIONAL_BOOKING_STATUSES = new Set(["awaiting_payment", "pending_payment"]);

export const normalizeBookingStatusKey = (status?: string | null) =>
  String(status ?? "").toLowerCase();

export const isPaidFinalBookingStatus = (status?: string | null) =>
  PAID_FINAL_BOOKING_STATUSES.has(normalizeBookingStatusKey(status));

export const isStripePaidStatus = (stripeStatus?: string | null) =>
  STRIPE_PAID_STATUSES.has(normalizeBookingStatusKey(stripeStatus));

// Bare status-flip cancellation (no refund) is safe only when NEITHER signal
// suggests a payment has completed. booking.status alone is not trusted --
// it can lag the real Stripe state (webhook race, or the status/stripe_status
// spelling drift already observed between stripe-webhook.ts's "succeeded"
// and sharedCheckout.ts's "paid") -- so stripe_status is checked
// independently and wins if it indicates a completed payment, regardless of
// what booking.status says.
export const canSelfCancelBooking = (
  status?: string | null,
  stripeStatus?: string | null
) => {
  if (isPaidFinalBookingStatus(status)) return false;
  if (isStripePaidStatus(stripeStatus)) return false;
  return SELF_CANCELLABLE_BOOKING_STATUSES.has(normalizeBookingStatusKey(status));
};

// checkout.session.expired eligibility: positively requires the row to
// still be in a pre-charge Checkout-provisional status (not merely "not
// yet marked paid"), AND requires stripe_status to not independently
// indicate a completed payment. Both conditions must hold, so a booking
// already finalized by checkout.session.completed -- regardless of
// event delivery order -- is never touched, and no status outside the
// narrow provisional set (declined, payment_failed, cancelled, or any
// future/unrecognized value) is ever auto-cancelled by this path.
export const canExpireUnpaidCheckout = (
  status?: string | null,
  stripeStatus?: string | null
) => {
  if (!CHECKOUT_PROVISIONAL_BOOKING_STATUSES.has(normalizeBookingStatusKey(status))) return false;
  if (isStripePaidStatus(stripeStatus)) return false;
  return true;
};
