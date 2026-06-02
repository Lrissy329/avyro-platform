import { differenceInCalendarDays } from "date-fns";
import { parseIsoDateOnly } from "@/lib/sharedStay";
import { isMissingSharedSchema } from "@/lib/sharedGroupsDb";

type SupabaseLike = any;
type StripeCheckoutSessionLike = {
  id: string;
  metadata?: Record<string, string | null | undefined>;
  payment_intent?: string | { id?: string | null } | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string | null;
};

const toUtcStartIso = (dateOnly: string) => `${dateOnly}T00:00:00.000Z`;

export const isSharedGroupCheckoutSession = (session: StripeCheckoutSessionLike | null | undefined) =>
  String(session?.metadata?.checkout_kind ?? "").toLowerCase() === "shared_group_member";

export async function finalizeSharedGroupCheckout(params: {
  supabaseAdmin: SupabaseLike;
  session: StripeCheckoutSessionLike;
}) {
  const { supabaseAdmin, session } = params;
  if (!isSharedGroupCheckoutSession(session)) {
    return { handled: false as const, bookingId: null as string | null };
  }

  const metadata = session.metadata ?? {};
  const sharedGroupId = String(metadata.shared_group_id ?? "");
  const sharedGroupMemberId = String(metadata.shared_group_member_id ?? "");
  const listingId = String(metadata.listing_id ?? "");
  const hostId = String(metadata.host_id ?? "");
  const guestId = String(metadata.guest_id ?? "");
  const checkIn = String(metadata.check_in ?? "");
  const checkOut = String(metadata.check_out ?? "");
  if (
    !sharedGroupId ||
    !sharedGroupMemberId ||
    !listingId ||
    !hostId ||
    !guestId ||
    !checkIn ||
    !checkOut
  ) {
    return {
      handled: true as const,
      bookingId: null as string | null,
      error: "Shared checkout metadata is incomplete.",
      code: "SHARED_CHECKOUT_METADATA_MISSING",
    };
  }

  const checkInDate = parseIsoDateOnly(checkIn);
  const checkOutDate = parseIsoDateOnly(checkOut);
  if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
    return {
      handled: true as const,
      bookingId: null as string | null,
      error: "Shared checkout dates are invalid.",
      code: "SHARED_CHECKOUT_DATES_INVALID",
    };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent && typeof session.payment_intent === "object"
      ? session.payment_intent.id ?? null
      : null;
  const amountPence = Number.isFinite(Number(session.amount_total))
    ? Math.max(0, Math.round(Number(session.amount_total)))
    : 0;
  const currency = String(session.currency ?? "GBP").toUpperCase();
  const nights = Math.max(1, differenceInCalendarDays(checkOutDate, checkInDate));
  const guestUnitPricePence = nights > 0 ? Math.round(amountPence / nights) : amountPence;

  const memberUpdate = await supabaseAdmin
    .from("shared_group_members")
    .update({
      status: "confirmed",
      amount_paid_pence: amountPence,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sharedGroupMemberId)
    .eq("shared_group_id", sharedGroupId)
    .in("status", ["pending", "confirmed"])
    .select("id")
    .maybeSingle();

  if (memberUpdate.error) {
    return {
      handled: true as const,
      bookingId: null as string | null,
      error: memberUpdate.error.message ?? "Failed to confirm shared-group member.",
      code: "SHARED_MEMBER_CONFIRM_FAILED",
    };
  }

  const existingBookingResult = await supabaseAdmin
    .from("bookings")
    .select("id")
    .eq("booking_type", "shared_group")
    .eq("shared_group_id", sharedGroupId)
    .eq("guest_id", guestId)
    .limit(1)
    .maybeSingle();

  if (existingBookingResult.error && !isMissingSharedSchema(existingBookingResult.error)) {
    return {
      handled: true as const,
      bookingId: null as string | null,
      error: existingBookingResult.error.message ?? "Failed to check existing shared booking.",
      code: "SHARED_BOOKING_LOOKUP_FAILED",
    };
  }

  let bookingId: string | null = existingBookingResult.data?.id ?? null;

  const bookingPayload = {
    listing_id: listingId,
    host_id: hostId,
    guest_id: guestId,
    status: "confirmed",
    payout_status: "awaiting_payout",
    stay_type: "nightly",
    channel: "direct",
    check_in_time: toUtcStartIso(checkIn),
    check_out_time: toUtcStartIso(checkOut),
    nights,
    currency,
    price_total: amountPence / 100,
    host_net_total_pence: amountPence,
    guest_total_pence: amountPence,
    guest_unit_price_pence: guestUnitPricePence,
    booking_type: "shared_group",
    shared_group_id: sharedGroupId,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_status: session.payment_status ?? "succeeded",
    amount: amountPence,
  };

  if (!bookingId) {
    const insertBooking = await supabaseAdmin
      .from("bookings")
      .insert(bookingPayload)
      .select("id")
      .single();

    if (insertBooking.error) {
      return {
        handled: true as const,
        bookingId: null as string | null,
        error: insertBooking.error.message ?? "Failed to create shared booking.",
        code: "SHARED_BOOKING_CREATE_FAILED",
      };
    }
    bookingId = insertBooking.data?.id ?? null;
  } else {
    const updateBooking = await supabaseAdmin
      .from("bookings")
      .update(bookingPayload)
      .eq("id", bookingId);

    if (updateBooking.error) {
      return {
        handled: true as const,
        bookingId,
        error: updateBooking.error.message ?? "Failed to update shared booking.",
        code: "SHARED_BOOKING_UPDATE_FAILED",
      };
    }
  }

  return {
    handled: true as const,
    bookingId,
  };
}
