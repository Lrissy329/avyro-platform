import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase service role configuration for Stripe webhook handler.");
}

if (!webhookSecret) {
  throw new Error("STRIPE_WEBHOOK_SECRET is not set");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function resolvePaymentIntentFromTransfer(transfer: any): Promise<string | null> {
  if (transfer?.metadata?.payment_intent_id) {
    return transfer.metadata.payment_intent_id as string;
  }

  if (transfer?.metadata?.stripe_payment_intent_id) {
    return transfer.metadata.stripe_payment_intent_id as string;
  }

  const sourceTransaction = transfer?.source_transaction;
  if (typeof sourceTransaction === "string") {
    try {
      const charge = await stripe.charges.retrieve(sourceTransaction);
      if (typeof charge?.payment_intent === "string") {
        return charge.payment_intent;
      }
    } catch (err) {
      console.error("[stripe-webhook] failed to resolve payment intent from charge:", err);
    }
  }

  const destinationPayment = transfer?.destination_payment;
  if (typeof destinationPayment === "string") {
    try {
      const destinationCharge = await stripe.charges.retrieve(destinationPayment);
      if (typeof destinationCharge?.payment_intent === "string") {
        return destinationCharge.payment_intent;
      }
    } catch (err) {
      console.error("[stripe-webhook] failed to resolve payment intent from destination payment:", err);
    }
  }

  return null;
}

async function resolvePaymentIntentFromPayout(payout: any): Promise<string | null> {
  if (payout?.metadata?.payment_intent_id) {
    return payout.metadata.payment_intent_id as string;
  }

  if (payout?.metadata?.stripe_payment_intent_id) {
    return payout.metadata.stripe_payment_intent_id as string;
  }

  const relatedTransferId = payout?.metadata?.transfer_id ?? payout?.metadata?.stripe_transfer_id;
  if (typeof relatedTransferId === "string") {
    try {
      const transfer = await stripe.transfers.retrieve(relatedTransferId);
      return resolvePaymentIntentFromTransfer(transfer);
    } catch (err) {
      console.error("[stripe-webhook] failed to resolve payment intent from transfer:", err);
    }
  }

  return null;
}

async function updateBookingPayoutStatus({
  bookingId,
  paymentIntentId,
  status,
}: {
  bookingId?: string | null;
  paymentIntentId?: string | null;
  status: "awaiting_payout" | "in_transit" | "paid" | "failed";
}) {
  const updatePayload: Record<string, any> = {
    payout_status: status,
  };

  if (status === "paid") {
    updatePayload.payout_released_at = new Date().toISOString();
  }

  let query = null;
  if (paymentIntentId) {
    query = supabaseAdmin
      .from("bookings")
      .update(updatePayload)
      .eq("stripe_payment_intent_id", paymentIntentId)
      .select("id");
  } else if (bookingId) {
    query = supabaseAdmin.from("bookings").update(updatePayload).eq("id", bookingId).select("id");
  }

  if (!query) {
    console.warn("[stripe-webhook] payout event missing identifiers; no booking updated.");
    return;
  }

  const { error, data } = await query;
  if (error) {
    console.error("[stripe-webhook] failed to update payout status:", error);
    return;
  }

  if (!data || data.length === 0) {
    console.warn("[stripe-webhook] payout update matched no bookings.");
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    return res.status(400).send("Missing Stripe signature header");
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("[stripe-webhook] signature verification failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err?.message ?? "Invalid signature"}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const metadata = session?.metadata ?? {};
        const bookingId = metadata.booking_id ?? metadata.bookingId ?? null;
        const listingId = metadata.listingId ?? null;
        const guestId = metadata.guestId ?? null;
        const hostId = metadata.hostId ?? null;

        const paymentIntentId =
          typeof session.payment_intent === "string" ? (session.payment_intent as string) : null;

        let amount = typeof session.amount_total === "number" ? session.amount_total : 0;
        let currency =
          typeof session.currency === "string" ? session.currency.toUpperCase() : "GBP";

        if (paymentIntentId && (!amount || amount <= 0)) {
          try {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            amount = pi.amount_received ?? pi.amount ?? amount;
            if (pi.currency) {
              currency = pi.currency.toUpperCase();
            }
          } catch (err) {
            console.error("[stripe-webhook] failed to fetch payment intent:", err);
          }
        }

        const fullPayload: Record<string, any> = {
          status: "paid",
          payout_status: "awaiting_payout",
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId,
          amount,
          currency,
        };

        const fallbackPayload: Record<string, any> = {
          status: "paid",
          payout_status: "awaiting_payout",
        };

        const applyUpdate = async (payload: Record<string, any>) => {
          if (bookingId) {
            return supabaseAdmin.from("bookings").update(payload).eq("id", bookingId).select("id");
          }

          if (listingId && guestId && hostId) {
            return supabaseAdmin
              .from("bookings")
              .update(payload)
              .eq("listing_id", listingId)
              .eq("guest_id", guestId)
              .eq("host_id", hostId)
              .eq("status", "pending")
              .select("id");
          }

          return null;
        };

        let updateResult = await applyUpdate(fullPayload);

        if (!updateResult) {
          console.warn(
            "[stripe-webhook] checkout.session.completed missing booking identifiers; no update performed."
          );
          break;
        }

        if (updateResult?.error) {
          console.warn(
            "[stripe-webhook] detailed booking update failed, retrying with minimal payload:",
            updateResult.error
          );
          updateResult = await applyUpdate(fallbackPayload);
        }

        if (updateResult?.error) {
          console.error("[stripe-webhook] failed to update booking:", updateResult.error);
        } else if (updateResult && (!updateResult.data || updateResult.data.length === 0)) {
          console.warn("[stripe-webhook] booking update matched no rows. Ensure booking exists.");
        }

        break;
      }

      case "payment_intent.succeeded": {
        // Checkout handler above already manages booking state, but you could mirror status here if needed.
        break;
      }

      case "account.updated": {
        const account = event.data.object as any;
        const accountId = account?.id as string | undefined;
        if (!accountId) break;

        if (account?.details_submitted) {
          const { error } = await supabaseAdmin
            .from("profiles")
            .update({ stripe_onboarding_status: "complete" })
            .eq("stripe_account_id", accountId);

          if (error) {
            console.error("[stripe-webhook] failed to update host profile:", error);
          }
        }

        break;
      }

      case "transfer.paid": {
        const transfer = event.data.object as any;
        const bookingId = transfer?.metadata?.booking_id ?? transfer?.metadata?.bookingId ?? null;
        const paymentIntentId = await resolvePaymentIntentFromTransfer(transfer);

        await updateBookingPayoutStatus({
          bookingId,
          paymentIntentId,
          status: "in_transit",
        });
        break;
      }

      case "payout.paid": {
        const payout = event.data.object as any;
        const bookingId = payout?.metadata?.booking_id ?? payout?.metadata?.bookingId ?? null;
        const paymentIntentId = await resolvePaymentIntentFromPayout(payout);

        await updateBookingPayoutStatus({
          bookingId,
          paymentIntentId,
          status: "paid",
        });
        break;
      }

      case "payout.failed": {
        const payout = event.data.object as any;
        const bookingId = payout?.metadata?.booking_id ?? payout?.metadata?.bookingId ?? null;
        const paymentIntentId = await resolvePaymentIntentFromPayout(payout);

        await updateBookingPayoutStatus({
          bookingId,
          paymentIntentId,
          status: "failed",
        });
        break;
      }

      default:
        // Ignore unhandled events
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("[stripe-webhook] handler error:", err);
    return res.status(500).send("Webhook handler error");
  }
}
