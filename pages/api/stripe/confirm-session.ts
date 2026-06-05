import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { finalizeSharedGroupCheckout, isSharedGroupCheckoutSession } from "@/lib/sharedCheckout";
import { sendBookingEmails } from "@/lib/email/sendBookingEmails";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase service role configuration for checkout confirmation handler.");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

const isPaidLikeStatus = (status?: string | null) =>
  ["paid", "complete", "succeeded"].includes(String(status ?? "").toLowerCase());

const isFinalizedBookingState = (status?: string | null, stripeStatus?: string | null) =>
  ["confirmed", "paid", "completed"].includes(String(status ?? "").toLowerCase()) &&
  isPaidLikeStatus(stripeStatus);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sessionId = req.query.session_id;
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "session_id query param required" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    if (!session) {
      return res.status(404).json({ error: "Checkout session not found" });
    }

    const paymentIntentStatus =
      session.payment_intent && typeof session.payment_intent === "object"
        ? (session.payment_intent as any)?.status
        : null;
    const hasPaid =
      isPaidLikeStatus(session.payment_status ?? "") ||
      isPaidLikeStatus(session.status ?? "") ||
      isPaidLikeStatus(paymentIntentStatus);
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? (session.payment_intent as string)
        : typeof session.payment_intent === "object"
        ? (session.payment_intent as any)?.id
        : null;

    const metadata = session.metadata ?? {};
    if (isSharedGroupCheckoutSession(session as any)) {
      if (!hasPaid) {
        const metadataBookingId = String(metadata.booking_id ?? metadata.bookingId ?? "");
        if (metadataBookingId) {
          const { data: existingSharedBooking } = await supabaseAdmin
            .from("bookings")
            .select("id, status, stripe_status")
            .eq("id", metadataBookingId)
            .maybeSingle();
          if (
            existingSharedBooking?.id &&
            isFinalizedBookingState(existingSharedBooking.status, existingSharedBooking.stripe_status)
          ) {
            return res.status(200).json({ success: true, bookingId: existingSharedBooking.id });
          }
        }
        return res.status(409).json({ error: "Checkout session not paid yet" });
      }

      const sharedResult = await finalizeSharedGroupCheckout({
        supabaseAdmin,
        session: session as any,
      });
      if (sharedResult.error) {
        return res.status(500).json({ error: sharedResult.error });
      }
      if (sharedResult.bookingId) {
        try {
          await sendBookingEmails({
            supabaseAdmin,
            bookingId: sharedResult.bookingId,
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
          });
        } catch (emailError) {
          console.warn("[stripe/confirm-session] shared booking email send failed", emailError);
        }
      }
      return res.status(200).json({ success: true, bookingId: sharedResult.bookingId });
    }

    if (!hasPaid) {
      return res.status(409).json({ error: "Checkout session not paid yet" });
    }

    const bookingId = (metadata.booking_id ?? metadata.bookingId ?? null) as string | null;
    const listingId = (metadata.listingId ?? null) as string | null;
    const hostId = (metadata.hostId ?? null) as string | null;
    const guestId = (metadata.guestId ?? null) as string | null;

    let amountMinor: number | null = null;
    if (typeof session.amount_total === "number") {
      amountMinor = session.amount_total;
    } else if (typeof (session.payment_intent as any)?.amount_received === "number") {
      amountMinor = (session.payment_intent as any).amount_received;
    }
    const currencyCode =
      (session.currency ?? (session as any).currency)?.toString().toUpperCase() ?? "GBP";

    const payload: Record<string, any> = {
      status: "confirmed",
      payout_status: "awaiting_payout",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_status: "succeeded",
    };
    if (amountMinor && amountMinor > 0) {
      payload.price_total = amountMinor / 100;
      payload.currency = currencyCode;
    }
    const applyUpdate = async () => {
      if (bookingId) {
        return supabaseAdmin.from("bookings").update(payload).eq("id", bookingId).select("id");
      }
      if (listingId && hostId && guestId) {
        return supabaseAdmin
          .from("bookings")
          .update(payload)
          .eq("listing_id", listingId)
          .eq("host_id", hostId)
          .eq("guest_id", guestId)
          .in("status", ["pending", "awaiting_payment"])
          .select("id");
      }
      return null;
    };

    const result = await applyUpdate();
    if (!result) {
      const fallback = await supabaseAdmin
        .from("bookings")
        .update(payload)
        .eq("stripe_checkout_session_id", session.id)
        .select("id");
      if (fallback?.error) {
        return res.status(409).json({ error: "Unable to match booking for this session." });
      }
      const resolvedBookingId = fallback.data?.[0]?.id ?? bookingId;
      if (resolvedBookingId) {
        try {
          await sendBookingEmails({
            supabaseAdmin,
            bookingId: resolvedBookingId,
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
          });
        } catch (emailError) {
          console.warn("[stripe/confirm-session] booking email send failed", emailError);
        }
      }
      return res.status(200).json({ success: true, bookingId: resolvedBookingId });
    }
    if (result.error) {
      const paidFallback = { ...payload, status: "paid" };
      await supabaseAdmin
        .from("bookings")
        .update(paidFallback)
        .eq("stripe_checkout_session_id", session.id);
      return res.status(500).json({ error: result.error.message });
    }

    const resolvedBookingId = result.data?.[0]?.id ?? bookingId;
    if (resolvedBookingId) {
      try {
        await sendBookingEmails({
          supabaseAdmin,
          bookingId: resolvedBookingId,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
        });
      } catch (emailError) {
        console.warn("[stripe/confirm-session] booking email send failed", emailError);
      }
    }

    return res.status(200).json({ success: true, bookingId: resolvedBookingId });
  } catch (err: any) {
    console.error("[stripe/confirm-session]", err);
    return res.status(500).json({ error: err?.message ?? "Server error" });
  }
}
