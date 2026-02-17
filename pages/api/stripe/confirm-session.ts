import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase service role configuration for checkout confirmation handler.");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

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

    const paidStatuses = new Set(["paid", "complete"]);
    const hasPaid = paidStatuses.has(session.payment_status ?? "") || paidStatuses.has(session.status ?? "");

    if (!hasPaid) {
      return res.status(409).json({ error: "Checkout session not paid yet" });
    }

    const metadata = session.metadata ?? {};
    const bookingId = (metadata.booking_id ?? metadata.bookingId ?? null) as string | null;
    const listingId = (metadata.listingId ?? null) as string | null;
    const hostId = (metadata.hostId ?? null) as string | null;
    const guestId = (metadata.guestId ?? null) as string | null;

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? (session.payment_intent as string)
        : typeof session.payment_intent === "object"
        ? (session.payment_intent as any)?.id
        : null;

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
      return res.status(200).json({ success: true, bookingId: fallback.data?.[0]?.id ?? bookingId });
    }
    if (result.error) {
      const paidFallback = { ...payload, status: "paid" };
      await supabaseAdmin
        .from("bookings")
        .update(paidFallback)
        .eq("stripe_checkout_session_id", session.id);
      return res.status(500).json({ error: result.error.message });
    }

    return res.status(200).json({ success: true, bookingId: result.data?.[0]?.id ?? bookingId });
  } catch (err: any) {
    console.error("[stripe/confirm-session]", err);
    return res.status(500).json({ error: err?.message ?? "Server error" });
  }
}
