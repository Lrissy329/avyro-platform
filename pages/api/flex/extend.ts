import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { stripe } from "@/lib/stripe";
import { ensureRangeAvailable } from "@/lib/flexAvailability";
import { calculateFlexCharge, type FlexPricingPolicy } from "@/lib/flexPricing";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getHostStripeReadiness } from "@/lib/hostStripeReadiness";
import { PLATFORM_FEE_CAP_PENCE } from "@/lib/pricing";
import {
  addDaysUtc,
  computeRollingFlexCutoff,
  diffNightsUtc,
  isMissingColumnError,
  toUtcDateOnly,
  toUtcDateOnlyString,
} from "@/lib/flexStay";

type ExtendResponse =
  | {
      ok: true;
      booking: {
        id: string;
        checkOutTime: string;
        flexStatus: string;
        currentConfirmedEnd: string | null;
        nextHeldWindow: {
          startDate: string;
          endDate: string;
          cutoffAt: string | null;
        } | null;
        extensionPaymentIntentId: string | null;
      };
    }
  | { error: string; code?: string };

const bookingSelects = [
  "id, guest_id, host_id, listing_id, status, currency, nights, price_total, guest_total_pence, guest_unit_price_pence, amount_paid_pence, confirmed_total_pence, latest_repriced_total_pence, discount_tier_applied, platform_fee_bps, stripe_payment_intent_id, flex_mode, flex_status, flex_max_end, flex_rolling_window_days, flex_pricing_multiplier, flex_pricing_policy, flex_current_confirmed_end",
  "id, guest_id, host_id, listing_id, status, currency, nights, price_total, guest_total_pence, guest_unit_price_pence, amount_paid_pence, confirmed_total_pence, latest_repriced_total_pence, platform_fee_bps, stripe_payment_intent_id, flex_mode, flex_status, flex_max_end, flex_rolling_window_days, flex_current_confirmed_end",
  "id, guest_id, host_id, listing_id, status, currency, nights, price_total, guest_total_pence, guest_unit_price_pence, platform_fee_bps, stripe_payment_intent_id, flex_mode, flex_status",
] as const;

const insertSystemMessage = async ({
  supabase,
  bookingId,
  hostId,
  body,
}: {
  supabase: any;
  bookingId: string;
  hostId?: string | null;
  body: string;
}) => {
  try {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("booking_id", bookingId)
      .maybeSingle();
    const conversationId = conversation?.id;
    if (!conversationId) return;

    const primary = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: null,
        sender_role: "system",
        body,
      })
      .select("created_at")
      .single();

    if (primary.error) {
      const fallback = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: hostId ?? null,
          body,
        })
        .select("created_at")
        .single();
      if (fallback.data?.created_at) {
        await supabase
          .from("conversations")
          .update({ last_message_at: fallback.data.created_at })
          .eq("id", conversationId);
      }
      return;
    }

    if (primary.data?.created_at) {
      await supabase
        .from("conversations")
        .update({ last_message_at: primary.data.created_at })
        .eq("id", conversationId);
    }
  } catch (error) {
    console.warn("[api/flex/extend] system message failed", error);
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ExtendResponse>) {
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
  for (const select of bookingSelects) {
    const result = await supabase.from("bookings").select(select).eq("id", bookingId).maybeSingle();
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
    return res.status(409).json({ error: "Booking is not eligible for extension." });
  }

  const flexMode = String(booking.flex_mode ?? "").toLowerCase();
  if (flexMode !== "rolling") {
    return res.status(409).json({ error: "Booking is not in rolling flex mode." });
  }

  const flexStatus = String(booking.flex_status ?? "").toLowerCase();
  if (flexStatus !== "active") {
    return res.status(409).json({ error: "Rolling flex is not active for this booking." });
  }

  const heldWindowResult = await supabase
    .from("booking_flex_windows")
    .select("id, start_date, end_date, cutoff_at, status")
    .eq("booking_id", bookingId)
    .eq("status", "held")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (heldWindowResult.error) {
    return res.status(500).json({ error: heldWindowResult.error.message ?? "Unable to load held window." });
  }
  const heldWindow = heldWindowResult.data;
  if (!heldWindow?.id || !heldWindow.start_date || !heldWindow.end_date) {
    return res.status(409).json({
      error: "That extension is no longer available. Check current availability to book more nights.",
      code: "FLEX_ROLLING_WINDOW_UNAVAILABLE",
    });
  }

  const startDate = toUtcDateOnly(String(heldWindow.start_date));
  const endDate = toUtcDateOnly(String(heldWindow.end_date));
  if (!startDate || !endDate || endDate <= startDate) {
    return res.status(409).json({ error: "Held window dates are invalid." });
  }

  const cutoff =
    (heldWindow.cutoff_at ? new Date(heldWindow.cutoff_at) : null) ??
    computeRollingFlexCutoff({
      confirmedEndDate: heldWindow.start_date,
      daysBefore: 2,
      cutoffHour: 18,
      timezone: "Europe/London",
    });
  if (!cutoff || !Number.isFinite(cutoff.getTime())) {
    return res.status(409).json({ error: "Extension cutoff is unavailable." });
  }
  const now = new Date();
  if (now.getTime() > cutoff.getTime()) {
    return res.status(409).json({
      error: "The extension cutoff has passed for this window.",
      code: "FLEX_CUTOFF_PASSED",
    });
  }

  const windowNights = diffNightsUtc(startDate, endDate);
  if (windowNights <= 0) {
    return res.status(409).json({ error: "Held window has no chargeable nights." });
  }
  if (!booking.listing_id) {
    return res.status(409).json({ error: "Listing context is missing for this booking." });
  }

  const heldWindowStillAvailable = await ensureRangeAvailable({
    supabase,
    listingId: String(booking.listing_id),
    startDate,
    endDate,
    excludeBookingId: String(booking.id),
    excludeFlexWindowId: String(heldWindow.id),
  });
  if (!heldWindowStillAvailable) {
    return res.status(409).json({
      error: "That extension is no longer available. Check current availability to book more nights.",
      code: "FLEX_EXTENSION_CONFLICT",
    });
  }

  const baseUnitPence = (() => {
    const explicit = Number(booking.guest_unit_price_pence);
    if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
    const total = Number(booking.guest_total_pence);
    const nights = Number(booking.nights);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(nights) && nights > 0) {
      return Math.round(total / nights);
    }
    return null;
  })();
  if (!baseUnitPence) {
    return res.status(409).json({ error: "Extension pricing data is unavailable." });
  }

  const multiplierRaw = Number(booking.flex_pricing_multiplier ?? 1);
  const multiplier = Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1;
  const flexPricingPolicy: FlexPricingPolicy =
    String(booking.flex_pricing_policy ?? "").toLowerCase() === "reprice_on_threshold"
      ? "reprice_on_threshold"
      : "incremental_only";

  const listingRatesResult = await supabase
    .from("listings")
    .select("price_per_night, price_per_week, price_per_month")
    .eq("id", booking.listing_id)
    .maybeSingle();
  const listingRates = listingRatesResult.data ?? null;

  const weeklyDiscountPct = (() => {
    const nightly = Number(listingRates?.price_per_night);
    const weekly = Number(listingRates?.price_per_week);
    if (!Number.isFinite(nightly) || nightly <= 0) return 0;
    if (!Number.isFinite(weekly) || weekly <= 0) return 0;
    const fullWeek = nightly * 7;
    if (weekly >= fullWeek) return 0;
    return Math.max(0, Math.min(100, ((fullWeek - weekly) / fullWeek) * 100));
  })();
  const monthlyDiscountPct = (() => {
    const nightly = Number(listingRates?.price_per_night);
    const monthly = Number(listingRates?.price_per_month);
    if (!Number.isFinite(nightly) || nightly <= 0) return 0;
    if (!Number.isFinite(monthly) || monthly <= 0) return 0;
    const fullMonth = nightly * 30;
    if (monthly >= fullMonth) return 0;
    return Math.max(0, Math.min(100, ((fullMonth - monthly) / fullMonth) * 100));
  })();

  const amountPaidBaseline =
    Number.isFinite(Number(booking.amount_paid_pence))
      ? Number(booking.amount_paid_pence)
      : Number.isFinite(Number(booking.guest_total_pence))
      ? Number(booking.guest_total_pence)
      : 0;
  const confirmedNights = Number.isFinite(Number(booking.nights))
    ? Math.max(0, Math.round(Number(booking.nights)))
    : 0;

  const pricingSnapshot = calculateFlexCharge({
    confirmedNights,
    extensionNights: windowNights,
    alreadyPaidPence: amountPaidBaseline,
    nightlyRatePence: baseUnitPence,
    weeklyDiscountPct,
    monthlyDiscountPct,
    flexPricingPolicy,
    flexPricingMultiplier: multiplier,
  });
  const extensionAmountPence = pricingSnapshot.amountDueNowPence;
  const extensionUnitPence = pricingSnapshot.nightlyRateUsedForExtensionPence;

  let extensionPaymentIntent: any = null;
  if (extensionAmountPence > 0) {
    // Host Stripe Connect readiness gate -- must run before any Stripe
    // call (including the prior-PaymentIntent lookup below, which exists
    // solely to prepare this charge). Scoped inside this
    // extensionAmountPence > 0 block deliberately: when the extension is
    // fully covered without a new charge, no Stripe call happens at all,
    // so there is nothing to gate. No DB state mutation for this
    // extension happens anywhere above this point either -- the booking
    // row and booking_flex_windows updates further below only run after
    // this block completes (or is skipped), so there is no phantom
    // payable/committed state created before the charge.
    if (!booking.host_id) {
      return res.status(409).json({ error: "Host context is missing for this booking." });
    }
    const hostReadiness = await getHostStripeReadiness(String(booking.host_id));
    if (!hostReadiness.ready || !hostReadiness.stripeAccountId) {
      console.error("[api/flex/extend] host not ready for Stripe Connect charge", {
        hostId: booking.host_id,
        bookingId: booking.id,
        stripeAccountId: hostReadiness.stripeAccountId,
        chargesEnabled: hostReadiness.chargesEnabled,
        payoutsEnabled: hostReadiness.payoutsEnabled,
      });
      return res.status(409).json({ error: "Host is not ready to accept payments.", code: "HOST_NOT_ONBOARDED" });
    }
    const hostStripeAccountId = hostReadiness.stripeAccountId;

    // application_fee_amount uses this booking's own existing
    // platform_fee_bps (the same basis P0-E established for flex/confirm.ts)
    // and the same per-charge cap semantics confirmed there -- no fresh
    // calculation invented, no cross-charge aggregate cap.
    const platformFeeBps = Number(booking.platform_fee_bps);
    if (!Number.isFinite(platformFeeBps) || platformFeeBps < 0) {
      console.error("[api/flex/extend] booking has no trustworthy platform_fee_bps", {
        bookingId: booking.id,
        raw: booking.platform_fee_bps,
      });
      return res.status(500).json({ error: "Unable to determine platform fee for this booking." });
    }
    const applicationFeeAmount = Math.min(
      Math.floor((extensionAmountPence * platformFeeBps) / 10000),
      PLATFORM_FEE_CAP_PENCE
    );
    if (
      !Number.isInteger(applicationFeeAmount) ||
      applicationFeeAmount < 0 ||
      applicationFeeAmount > extensionAmountPence
    ) {
      console.error("[api/flex/extend] computed application_fee_amount is invalid", {
        bookingId: booking.id,
        extensionAmountPence,
        platformFeeBps,
        applicationFeeAmount,
      });
      return res.status(500).json({ error: "Invalid application fee amount computed for this extension charge." });
    }

    if (!booking.stripe_payment_intent_id) {
      return res.status(409).json({
        error: "We couldn’t process your payment method. Update your payment details to extend your stay.",
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

    if (!paymentMethodId || !customerId) {
      return res.status(409).json({
        error: "We couldn’t process your payment method. Update your payment details to extend your stay.",
        code: "FLEX_PAYMENT_METHOD_MISSING",
      });
    }

    try {
      extensionPaymentIntent = await stripe.paymentIntents.create(
        {
          amount: extensionAmountPence,
          currency: String(booking.currency ?? "GBP").toLowerCase(),
          payment_method: paymentMethodId,
          customer: customerId,
          off_session: true,
          confirm: true,
          application_fee_amount: applicationFeeAmount,
          transfer_data: {
            destination: hostStripeAccountId,
          },
          metadata: {
            booking_id: String(booking.id),
            flex_mode: "rolling",
            flex_window_id: String(heldWindow.id),
            extension_unit_pence: String(extensionUnitPence),
            pricing_policy: flexPricingPolicy,
          },
          description: `Avyro rolling flex extension (${booking.id})`,
        },
        {
          idempotencyKey: `flex-extend-${heldWindow.id}`,
        }
      );
    } catch (error: any) {
      return res.status(402).json({
        error: "Unable to charge the saved card for this extension.",
        code: error?.code ?? "FLEX_CHARGE_FAILED",
      });
    }
  }

  const nextConfirmedEnd = toUtcDateOnlyString(endDate);
  const maxEndDate = toUtcDateOnly(String(booking.flex_max_end ?? ""));
  const rollingWindowDays = Math.max(1, Math.round(Number(booking.flex_rolling_window_days ?? 1)) || 1);
  const canCreateNextHeldWindow = Boolean(maxEndDate && endDate.getTime() < maxEndDate.getTime());

  let nextHeldWindow:
    | {
        startDate: string;
        endDate: string;
        cutoffAt: string | null;
      }
    | null = null;

  if (canCreateNextHeldWindow && maxEndDate) {
    const nextStart = endDate;
    const nextEndCandidate = addDaysUtc(nextStart, rollingWindowDays);
    const nextEnd = nextEndCandidate.getTime() <= maxEndDate.getTime() ? nextEndCandidate : maxEndDate;
    if (nextEnd.getTime() > nextStart.getTime()) {
      const nextStartDate = toUtcDateOnlyString(nextStart);
      const nextEndDate = toUtcDateOnlyString(nextEnd);
      const nextCutoffAt =
        computeRollingFlexCutoff({
          confirmedEndDate: nextStartDate,
          daysBefore: 2,
          cutoffHour: 18,
          timezone: "Europe/London",
        })?.toISOString() ?? null;
      nextHeldWindow = {
        startDate: nextStartDate,
        endDate: nextEndDate,
        cutoffAt: nextCutoffAt,
      };
    }
  }

  const updatePayload: Record<string, any> = {
    check_out_time: `${nextConfirmedEnd}T00:00:00.000Z`,
    flex_current_confirmed_end: nextConfirmedEnd,
    flex_last_extension_at: now.toISOString(),
    flex_extension_cutoff_at: nextHeldWindow?.cutoffAt ?? null,
    flex_status: nextHeldWindow ? "active" : "ended",
    flex_pricing_policy: flexPricingPolicy,
    confirmed_total_pence: pricingSnapshot.totalConfirmedStayValuePence,
    amount_paid_pence:
      pricingSnapshot.amountAlreadyPaidPence + pricingSnapshot.amountDueNowPence,
    latest_repriced_total_pence: pricingSnapshot.totalConfirmedStayValuePence,
    discount_tier_applied: pricingSnapshot.discountTierApplied,
  };
  if (Number.isFinite(Number(booking.nights))) {
    updatePayload.nights = Number(booking.nights) + windowNights;
  }
  updatePayload.guest_total_pence = pricingSnapshot.totalConfirmedStayValuePence;
  updatePayload.price_total = pricingSnapshot.totalConfirmedStayValuePence / 100;

  let bookingUpdate = await supabase
    .from("bookings")
    .update(updatePayload)
    .eq("id", bookingId)
    .eq("guest_id", session.user.id)
    .select("id, check_out_time, flex_status, flex_current_confirmed_end")
    .single();

  if (bookingUpdate.error && isMissingColumnError(bookingUpdate.error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.flex_current_confirmed_end;
    delete fallbackPayload.flex_last_extension_at;
    delete fallbackPayload.flex_extension_cutoff_at;
    delete fallbackPayload.flex_status;
    delete fallbackPayload.flex_pricing_policy;
    delete fallbackPayload.confirmed_total_pence;
    delete fallbackPayload.amount_paid_pence;
    delete fallbackPayload.latest_repriced_total_pence;
    delete fallbackPayload.discount_tier_applied;
    bookingUpdate = await supabase
      .from("bookings")
      .update(fallbackPayload)
      .eq("id", bookingId)
      .eq("guest_id", session.user.id)
      .select("id, check_out_time")
      .single();
  }

  if (bookingUpdate.error || !bookingUpdate.data?.id) {
    return res.status(500).json({ error: bookingUpdate.error?.message ?? "Booking extension update failed." });
  }

  const windowConfirmUpdate = await supabase
    .from("booking_flex_windows")
    .update({
      status: "confirmed",
      updated_at: now.toISOString(),
    })
    .eq("id", heldWindow.id)
    .eq("status", "held");

  if (windowConfirmUpdate.error) {
    return res.status(500).json({ error: windowConfirmUpdate.error.message ?? "Held window update failed." });
  }

  if (nextHeldWindow) {
    const insertResult = await supabase.from("booking_flex_windows").insert({
      booking_id: bookingId,
      start_date: nextHeldWindow.startDate,
      end_date: nextHeldWindow.endDate,
      status: "held",
      cutoff_at: nextHeldWindow.cutoffAt,
    });
    if (insertResult.error) {
      console.warn("[api/flex/extend] failed to create next held window", insertResult.error.message);
    }
  }

  await insertSystemMessage({
    supabase,
    bookingId,
    hostId: booking.host_id,
    body: `Your stay has been extended until ${nextConfirmedEnd}.`,
  });

  return res.status(200).json({
    ok: true,
    booking: {
      id: String(bookingUpdate.data.id),
      checkOutTime: String(bookingUpdate.data.check_out_time),
      flexStatus: String((bookingUpdate.data as any).flex_status ?? (nextHeldWindow ? "active" : "ended")),
      currentConfirmedEnd:
        typeof (bookingUpdate.data as any).flex_current_confirmed_end === "string"
          ? (bookingUpdate.data as any).flex_current_confirmed_end
          : nextConfirmedEnd,
      nextHeldWindow,
      extensionPaymentIntentId: String(extensionPaymentIntent?.id ?? "") || null,
    },
  });
}
