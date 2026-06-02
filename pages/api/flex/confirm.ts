import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { stripe } from "@/lib/stripe";
import { ensureRangeAvailable } from "@/lib/flexAvailability";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  addDaysUtc,
  getFlexCutoffAt,
  isMissingColumnError,
  isSameUtcDay,
} from "@/lib/flexStay";

type ConfirmResponse =
  | {
      ok: true;
      booking: {
        id: string;
        checkOutTime: string;
        flexStatus: string;
        flexPaymentIntentId: string | null;
      };
    }
  | { error: string; code?: string };

const listingSelects = [
  "id, listing_id, guest_id, status, currency, nights, check_out_time, stripe_payment_intent_id, guest_total_pence, confirmed_total_pence, amount_paid_pence, latest_repriced_total_pence, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence, flex_extra_night_cutoff_at",
  "id, listing_id, guest_id, status, currency, nights, check_out_time, stripe_payment_intent_id, guest_total_pence, confirmed_total_pence, amount_paid_pence, latest_repriced_total_pence, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
  "id, listing_id, guest_id, status, currency, nights, check_out_time, stripe_payment_intent_id, guest_total_pence, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
  "id, listing_id, guest_id, status, currency, nights, check_out_time, stripe_payment_intent_id, flex_extra_night, flex_extra_night_status",
] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ConfirmResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authClient = createPagesServerClient({ req, res });
  const {
    data: { session },
    error: sessionError,
  } = await authClient.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const bookingId = String((req.body as any)?.bookingId ?? "").trim();
  if (!bookingId) {
    return res.status(400).json({ error: "bookingId is required." });
  }

  const supabase = getSupabaseServerClient();

  let booking: any = null;
  let bookingError: any = null;
  for (const select of listingSelects) {
    const result = await supabase
      .from("bookings")
      .select(select)
      .eq("id", bookingId)
      .maybeSingle();

    booking = result.data ?? null;
    bookingError = result.error;
    if (!bookingError) break;
    if (!isMissingColumnError(bookingError)) break;
  }

  if (bookingError) {
    return res.status(500).json({ error: bookingError.message ?? "Unable to load booking." });
  }
  if (!booking?.id || booking.guest_id !== session.user.id) {
    return res.status(404).json({ error: "Booking not found." });
  }

  const bookingStatus = String(booking.status ?? "").toLowerCase();
  if (!["confirmed", "paid", "completed"].includes(bookingStatus)) {
    return res.status(409).json({ error: "Booking is not eligible for flex confirmation." });
  }

  if (!booking.flex_extra_night) {
    return res.status(409).json({ error: "Flex extra night is not enabled on this booking." });
  }

  const flexStatus = String(booking.flex_extra_night_status ?? "").toLowerCase();
  if (flexStatus !== "reserved") {
    return res.status(409).json({ error: "Flex extra night is no longer in reserved state." });
  }

  const checkout = new Date(String(booking.check_out_time ?? ""));
  if (!Number.isFinite(checkout.getTime())) {
    return res.status(409).json({ error: "Booking checkout time is invalid." });
  }
  const now = new Date();
  if (!isSameUtcDay(now, checkout)) {
    return res.status(409).json({ error: "Flex confirmation is only available on checkout day." });
  }

  const cutoff = getFlexCutoffAt(booking.check_out_time, booking.flex_extra_night_cutoff_at ?? null);
  if (!cutoff) {
    return res.status(409).json({ error: "Flex cutoff is unavailable." });
  }
  if (now > cutoff) {
    return res.status(409).json({ error: "Flex confirmation window has closed.", code: "FLEX_CUTOFF_PASSED" });
  }
  if (!booking.listing_id) {
    return res.status(409).json({ error: "Listing context is missing for this booking." });
  }

  const optionalNightStart = new Date(checkout);
  optionalNightStart.setUTCHours(0, 0, 0, 0);
  const optionalNightEnd = addDaysUtc(optionalNightStart, 1);
  const optionalNightAvailable = await ensureRangeAvailable({
    supabase,
    listingId: String(booking.listing_id),
    startDate: optionalNightStart,
    endDate: optionalNightEnd,
    excludeBookingId: String(booking.id),
  });
  if (!optionalNightAvailable) {
    return res.status(409).json({
      error: "The optional extra night can no longer be honoured.",
      code: "FLEX_EXTENSION_CONFLICT",
    });
  }

  const amountPence = Number(booking.flex_extra_night_price_pence);
  if (!Number.isFinite(amountPence) || amountPence <= 0) {
    return res.status(409).json({ error: "Flex extra night amount is not available." });
  }

  if (!booking.stripe_payment_intent_id) {
    return res.status(409).json({
      error: "No saved payment method found for this booking.",
      code: "FLEX_PAYMENT_METHOD_MISSING",
    });
  }

  let priorPaymentIntent: any;
  try {
    priorPaymentIntent = await stripe.paymentIntents.retrieve(String(booking.stripe_payment_intent_id));
  } catch (error: any) {
    return res.status(502).json({
      error: "Unable to load prior payment method.",
      code: error?.code ?? "STRIPE_LOOKUP_FAILED",
    });
  }

  const paymentMethodId =
    typeof priorPaymentIntent?.payment_method === "string"
      ? priorPaymentIntent.payment_method
      : priorPaymentIntent?.payment_method?.id ?? null;
  const customerId =
    typeof priorPaymentIntent?.customer === "string"
      ? priorPaymentIntent.customer
      : priorPaymentIntent?.customer?.id ?? null;

  if (!paymentMethodId) {
    return res.status(409).json({
      error: "No reusable card was found for this booking.",
      code: "FLEX_PAYMENT_METHOD_MISSING",
    });
  }

  if (!customerId) {
    return res.status(409).json({
      error: "No reusable payment profile was found for this booking.",
      code: "FLEX_PAYMENT_METHOD_MISSING",
    });
  }

  let flexPaymentIntent: any;
  try {
    flexPaymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amountPence),
      currency: String(booking.currency ?? "GBP").toLowerCase(),
      payment_method: paymentMethodId,
      customer: customerId,
      off_session: true,
      confirm: true,
      metadata: {
        booking_id: String(booking.id),
        flex_extra_night: "true",
      },
      description: `Avyro flex extra night (${booking.id})`,
    });
  } catch (error: any) {
    return res.status(402).json({
      error: "Unable to charge the saved card for the extra night.",
      code: error?.code ?? "FLEX_CHARGE_FAILED",
    });
  }

  const newCheckout = addDaysUtc(checkout, 1);
  const updatePayload: Record<string, any> = {
    check_out_time: newCheckout.toISOString(),
    flex_extra_night_status: "used",
    flex_extra_night_confirmed_at: now.toISOString(),
    flex_extra_night_payment_intent_id: String(flexPaymentIntent?.id ?? ""),
    confirmed_total_pence:
      (Number.isFinite(Number(booking.confirmed_total_pence))
        ? Number(booking.confirmed_total_pence)
        : Number.isFinite(Number(booking.guest_total_pence))
        ? Number(booking.guest_total_pence)
        : 0) + Math.round(amountPence),
    amount_paid_pence:
      (Number.isFinite(Number(booking.amount_paid_pence))
        ? Number(booking.amount_paid_pence)
        : Number.isFinite(Number(booking.guest_total_pence))
        ? Number(booking.guest_total_pence)
        : 0) + Math.round(amountPence),
    latest_repriced_total_pence:
      (Number.isFinite(Number(booking.latest_repriced_total_pence))
        ? Number(booking.latest_repriced_total_pence)
        : Number.isFinite(Number(booking.confirmed_total_pence))
        ? Number(booking.confirmed_total_pence)
        : Number.isFinite(Number(booking.guest_total_pence))
        ? Number(booking.guest_total_pence)
        : 0) + Math.round(amountPence),
  };

  if (Number.isFinite(Number(booking.nights))) {
    updatePayload.nights = Number(booking.nights) + 1;
  }

  let update = await supabase
    .from("bookings")
    .update(updatePayload)
    .eq("id", bookingId)
    .eq("guest_id", session.user.id)
    .select("id, check_out_time, flex_extra_night_status, flex_extra_night_payment_intent_id")
    .single();

  if (update.error && isMissingColumnError(update.error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.flex_extra_night_confirmed_at;
    delete fallbackPayload.flex_extra_night_payment_intent_id;
    delete fallbackPayload.confirmed_total_pence;
    delete fallbackPayload.amount_paid_pence;
    delete fallbackPayload.latest_repriced_total_pence;
    update = await supabase
      .from("bookings")
      .update(fallbackPayload)
      .eq("id", bookingId)
      .eq("guest_id", session.user.id)
      .select("id, check_out_time, flex_extra_night_status")
      .single();
  }

  if (update.error || !update.data?.id) {
    return res.status(500).json({ error: update.error?.message ?? "Flex booking update failed." });
  }

  return res.status(200).json({
    ok: true,
    booking: {
      id: String(update.data.id),
      checkOutTime: String(update.data.check_out_time),
      flexStatus: String(update.data.flex_extra_night_status ?? "used"),
      flexPaymentIntentId:
        typeof update.data.flex_extra_night_payment_intent_id === "string"
          ? update.data.flex_extra_night_payment_intent_id
          : typeof flexPaymentIntent?.id === "string"
          ? flexPaymentIntent.id
          : null,
    },
  });
}
