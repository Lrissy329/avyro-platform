import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";
import { stripe } from "@/lib/stripe";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

// Read-only Checkout Session status endpoint. pages/api/stripe-webhook.ts's
// checkout.session.completed handler is the sole authority for finalising
// a booking (status/payout/Stripe-identifier writes) and the sole sender
// of booking confirmation emails -- this route never mutates a booking and
// never sends email. It exists only so pages/booking/success.tsx can poll
// for whether that webhook-driven finalisation has landed yet.

const isPaidLikeStatus = (status?: string | null) =>
  ["paid", "complete", "succeeded"].includes(String(status ?? "").toLowerCase());

const isFinalizedBookingState = (status?: string | null, stripeStatus?: string | null) =>
  ["confirmed", "paid", "completed"].includes(String(status ?? "").toLowerCase()) &&
  isPaidLikeStatus(stripeStatus);

type ConfirmSessionResponse =
  | { status: "finalized"; bookingId: string; stripePaid: boolean }
  | { status: "pending"; bookingId: string | null; stripePaid: boolean }
  | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ConfirmSessionResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sessionId = req.query.session_id;
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "session_id query param required" });
  }

  const authClient = createPagesServerClient({ req, res });
  const {
    data: { session: authSession },
    error: authError,
  } = await authClient.auth.getSession();

  if (authError || !authSession?.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    if (!checkoutSession) {
      return res.status(404).json({ error: "Checkout session not found" });
    }

    // Ownership check against Stripe's own recorded metadata (set by this
    // platform's server at session-creation time, so it's trusted) --
    // both bookings/create.ts and shared-groups/checkout.ts write
    // guest_id (snake_case); guestId is also checked defensively in case
    // of a differently-cased caller. This runs before any DB lookup so an
    // unauthorized caller can't use this endpoint to probe for the
    // existence of another guest's booking either.
    const metadata = checkoutSession.metadata ?? {};
    const metadataGuestId = String(metadata.guest_id ?? metadata.guestId ?? "");
    if (!metadataGuestId || metadataGuestId !== authSession.user.id) {
      return res.status(403).json({ error: "Not authorized to view this checkout session." });
    }

    const paymentIntentStatus =
      checkoutSession.payment_intent && typeof checkoutSession.payment_intent === "object"
        ? (checkoutSession.payment_intent as any)?.status
        : null;
    const stripePaid =
      isPaidLikeStatus(checkoutSession.payment_status ?? "") ||
      isPaidLikeStatus(checkoutSession.status ?? "") ||
      isPaidLikeStatus(paymentIntentStatus);

    const supabaseAdmin = getSupabaseServerClient();
    const metadataBookingId = String(metadata.booking_id ?? metadata.bookingId ?? "").trim();

    let bookingRow: { id: string; status: string | null; stripe_status: string | null; guest_id: string } | null =
      null;

    if (metadataBookingId) {
      const { data } = await supabaseAdmin
        .from("bookings")
        .select("id, status, stripe_status, guest_id")
        .eq("id", metadataBookingId)
        .maybeSingle();
      bookingRow = data ?? null;
    }

    if (!bookingRow) {
      const { data } = await supabaseAdmin
        .from("bookings")
        .select("id, status, stripe_status, guest_id")
        .eq("stripe_checkout_session_id", checkoutSession.id)
        .maybeSingle();
      bookingRow = data ?? null;
    }

    if (bookingRow && bookingRow.guest_id !== authSession.user.id) {
      // Defensive: whatever the fallback lookup resolved to doesn't belong
      // to the caller either -- treat identically rather than leaking its
      // state.
      return res.status(403).json({ error: "Not authorized to view this checkout session." });
    }

    // Authoritative "is this done" signal is the booking's own DB state,
    // written only by stripe-webhook.ts -- never the raw Stripe session
    // status. Stripe reporting the session as paid does not by itself mean
    // the webhook has finalised the booking yet (that's exactly the race
    // this redesign closes); stripePaid above is returned only as
    // informational context for the caller, never used to decide "done".
    if (bookingRow && isFinalizedBookingState(bookingRow.status, bookingRow.stripe_status)) {
      return res.status(200).json({ status: "finalized", bookingId: bookingRow.id, stripePaid });
    }

    return res.status(200).json({ status: "pending", bookingId: bookingRow?.id ?? null, stripePaid });
  } catch (err: any) {
    console.error("[stripe/confirm-session]", err);
    return res.status(500).json({ error: err?.message ?? "Server error" });
  }
}
