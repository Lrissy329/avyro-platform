import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi } from "@/lib/opsAuth";
import { stripe } from "@/lib/stripe";
import { isPaidFinalBookingStatus } from "@/lib/bookingStatus";

// Ops full-refund action for destination charges. Replaces the manual
// "refund in the Stripe dashboard" instruction that used to live on
// pages/ops/bookings/[id].tsx -- this is the first automated refund path
// in the codebase.
//
// MVP scope is full refund only: reverse_transfer + refund_application_fee
// unwind the entire destination-charge (guest refunded in full, the
// host's transferred net clawed back, the platform's application fee
// returned) via a single stripe.refunds.create call. Partial refunds are
// an intentionally separate, later piece of work -- this endpoint isn't
// structured to half-support an amount parameter that the UI can't
// actually drive yet.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:bookings:write" });
  if (!guard) return;
  const { admin, staff } = guard;

  const bookingId = req.query.id as string;
  if (!bookingId) {
    return res.status(400).json({ error: "Missing booking id" });
  }

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("id, status, stripe_payment_intent_id, currency")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    return res.status(500).json({ error: bookingError.message });
  }
  if (!booking) {
    return res.status(404).json({ error: "Booking not found." });
  }
  if (!booking.stripe_payment_intent_id) {
    return res.status(409).json({ error: "This booking has no Stripe payment to refund." });
  }
  // Reuses the same paid/confirmed/completed definition already used
  // everywhere else in the app (lib/bookingStatus.ts) rather than
  // inventing a separate refundable-status policy. A booking already
  // "cancelled" (which is what a successful refund itself sets it to)
  // correctly falls outside this set, so this endpoint can't be used to
  // refund the same booking twice through its own status check.
  if (!isPaidFinalBookingStatus(booking.status)) {
    return res.status(409).json({
      error: "This booking is not in a refundable state.",
      code: "BOOKING_NOT_REFUNDABLE",
    });
  }

  const idempotencyKey = `ops-refund-${booking.id}`;
  let refund: any = null;

  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: booking.stripe_payment_intent_id,
        reverse_transfer: true,
        refund_application_fee: true,
      },
      { idempotencyKey }
    );
  } catch (error: any) {
    if (error?.code === "charge_already_refunded") {
      // This PaymentIntent was already fully refunded through some path
      // other than this exact idempotent request (e.g. a prior call to
      // this same endpoint whose Stripe call succeeded but whose DB/note
      // write then failed, or a manual Stripe Dashboard refund). Do not
      // attempt another refund -- look up the existing one and continue
      // the same DB/note/audit sequence against it, so retrying this
      // action is always safe and never creates a duplicate.
      try {
        const existingRefunds = await stripe.refunds.list({
          payment_intent: booking.stripe_payment_intent_id,
          limit: 1,
        });
        refund = existingRefunds.data[0] ?? null;
      } catch (listError: any) {
        console.error("[ops/bookings/refund] failed to look up existing refund after charge_already_refunded", {
          bookingId,
          paymentIntentId: booking.stripe_payment_intent_id,
          message: listError?.message,
        });
        return res.status(502).json({
          error:
            "This payment was already refunded in Stripe, but the existing refund could not be retrieved. Reconcile manually.",
        });
      }
      if (!refund) {
        console.error("[ops/bookings/refund] charge_already_refunded but no refund found via list", {
          bookingId,
          paymentIntentId: booking.stripe_payment_intent_id,
        });
        return res.status(502).json({
          error:
            "This payment was already refunded in Stripe, but no matching refund record could be found. Reconcile manually.",
        });
      }
    } else {
      console.error("[ops/bookings/refund] stripe refund failed", {
        bookingId,
        paymentIntentId: booking.stripe_payment_intent_id,
        message: error?.message,
        code: error?.code,
      });
      return res.status(502).json({ error: error?.message ?? "Stripe refund failed." });
    }
  }

  // From here on, the refund itself is a settled fact in Stripe (either
  // just created, or found via the reconciliation path above) --
  // reverse_transfer:true already handles the destination-charge/transfer
  // reversal, so no separate stripe.transfers.createReversal call is
  // made or needed.
  const refundAmountMajor = (Number(refund.amount ?? 0) / 100).toFixed(2);
  const refundCurrency = String(refund.currency ?? booking.currency ?? "GBP").toUpperCase();
  const noteText = `Full refund issued via ops console. Stripe refund ID: ${refund.id}. Amount: ${refundAmountMajor} ${refundCurrency}.`;

  // Note first, status second -- deliberately reversed from a naive
  // status-then-note order. If status flipped to "cancelled" first and the
  // note insert then failed, the booking would be stuck outside the
  // refundable-status gate above (status no longer paid/confirmed/
  // completed) with no audit trail of the refund, and a retry of this
  // exact action would be rejected before it could reach Stripe at all.
  // Writing the note first means status only ever becomes "cancelled"
  // once the audit record already exists, so a retry after any failure
  // below still finds the booking in a refundable status and can resume
  // exactly where it left off.
  const { data: existingNote, error: existingNoteError } = await admin
    .from("booking_notes")
    .select("id")
    .eq("booking_id", bookingId)
    .ilike("note", `%${refund.id}%`)
    .maybeSingle();

  if (existingNoteError) {
    console.error("[ops/bookings/refund] failed to check for an existing refund note", {
      bookingId,
      stripeRefundId: refund.id,
      error: existingNoteError.message,
    });
    return res.status(500).json({
      error: `The Stripe refund succeeded (ID: ${refund.id}) but checking for an existing audit note failed. Safe to retry.`,
    });
  }

  if (!existingNote) {
    const { error: noteError } = await admin.from("booking_notes").insert({
      booking_id: bookingId,
      staff_user_id: staff.user_id,
      note: noteText,
    });

    if (noteError) {
      console.error("[ops/bookings/refund] stripe refund succeeded but note insert failed", {
        bookingId,
        stripeRefundId: refund.id,
        refundAmountPence: refund.amount,
        refundCurrency,
        staffUserId: staff.user_id,
        error: noteError.message,
      });
      return res.status(500).json({
        error: `The Stripe refund succeeded (ID: ${refund.id}) but recording the audit note failed. This is safe to retry -- the same refund will be reused, not duplicated.`,
      });
    }
  }

  const { error: statusError } = await admin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);

  if (statusError) {
    console.error("[ops/bookings/refund] refund note recorded but booking status update failed", {
      bookingId,
      stripeRefundId: refund.id,
      refundAmountPence: refund.amount,
      refundCurrency,
      staffUserId: staff.user_id,
      error: statusError.message,
    });
    return res.status(500).json({
      error: `The refund was recorded (Stripe refund ID: ${refund.id}) but updating the booking status failed. This is safe to retry.`,
    });
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "booking_refunded",
    entity_type: "booking",
    entity_id: bookingId,
    payload: {
      stripe_refund_id: refund.id,
      stripe_payment_intent_id: booking.stripe_payment_intent_id,
      amount_pence: refund.amount,
      currency: refundCurrency,
    },
  });

  return res.status(200).json({
    success: true,
    refundId: refund.id,
    amountPence: refund.amount,
    currency: refundCurrency,
  });
}
