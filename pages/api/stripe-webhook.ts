import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { finalizeSharedGroupCheckout, isSharedGroupCheckoutSession } from "@/lib/sharedCheckout";
import { sendBookingEmails } from "@/lib/email/sendBookingEmails";
import { canExpireUnpaidCheckout } from "@/lib/bookingStatus";

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

  // Idempotency: track per-event processing state so a mid-flight handler
  // failure doesn't permanently mark an event as done (see
  // db/migrations/20260814_processed_stripe_events.sql). Lock acquisition
  // is a single atomic INSERT ... ON CONFLICT (event_id) DO NOTHING via
  // upsert(ignoreDuplicates: true) -- not a SELECT followed by an INSERT --
  // so two concurrent deliveries of the same event can never both win the
  // lock: Postgres's own unique-constraint enforcement decides the winner,
  // and `.select("event_id")` after an ignore-duplicates upsert returns a
  // row only for whichever request actually inserted it.
  const { data: lockRows, error: lockError } = await supabaseAdmin
    .from("processed_stripe_events")
    .upsert({ event_id: event.id, status: "processing" }, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id");

  if (lockError) {
    console.error("[stripe-webhook] failed to acquire event idempotency lock:", lockError);
    return res.status(500).send("Webhook idempotency check failed");
  }

  if (!lockRows || lockRows.length === 0) {
    // Someone already holds or has finished this event_id. This read never
    // gates a mutation -- it only decides how to respond -- so it doesn't
    // reopen the race the atomic insert above already resolved.
    const { data: existing, error: statusError } = await supabaseAdmin
      .from("processed_stripe_events")
      .select("status")
      .eq("event_id", event.id)
      .maybeSingle();

    if (statusError) {
      console.error("[stripe-webhook] failed to read event idempotency status:", statusError);
      return res.status(500).send("Webhook idempotency check failed");
    }

    if (existing?.status === "processed") {
      // Already fully handled by an earlier delivery -- acknowledge
      // without reprocessing.
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Either status === "processing" (a concurrent delivery is still
    // in-flight elsewhere) or the row was deleted between the failed
    // insert above and this read (an earlier attempt just failed and reset
    // itself). Do not run the handler here either way. A non-2xx makes
    // Stripe retry later: by then the in-flight attempt will have resolved
    // to "processed" (next retry returns 200 duplicate) or reset itself on
    // failure (next retry is free to reacquire the lock and process it).
    return res.status(409).send("Event is already being processed");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        if (isSharedGroupCheckoutSession(session)) {
          const sharedResult = await finalizeSharedGroupCheckout({
            supabaseAdmin,
            session,
          });
          if (sharedResult.error) {
            console.error("[stripe-webhook] shared checkout finalization failed:", sharedResult);
          } else if (sharedResult.bookingId) {
            try {
              await sendBookingEmails({
                supabaseAdmin,
                bookingId: sharedResult.bookingId,
                stripeCheckoutSessionId: session.id,
                stripePaymentIntentId:
                  typeof session.payment_intent === "string" ? session.payment_intent : null,
              });
            } catch (emailError) {
              console.warn("[stripe-webhook] shared booking email send failed:", emailError);
            }
          }
          break;
        }

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

        // "paid" (not "confirmed") is the canonical successful-Checkout
        // status for this schema -- the live bookings_status_check /
        // bookings_status_chk constraints do not include "confirmed" in
        // their allowed set, so any update attempting status:"confirmed"
        // is guaranteed to fail. isPaidFinalBookingStatus() (lib/
        // bookingStatus.ts) and confirm-session.ts's
        // isFinalizedBookingState() both already treat "paid" as fully
        // final, so no other file needs to change for this.
        //
        // Both payload tiers below always carry the Stripe identifiers --
        // there is no longer a further-degraded tier that can finalize a
        // paid booking while dropping stripe_checkout_session_id/
        // stripe_payment_intent_id.
        const fullPayload: Record<string, any> = {
          status: "paid",
          payout_status: "awaiting_payout",
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId,
          stripe_status: "succeeded",
          amount,
          currency,
        };

        const fallbackPayload: Record<string, any> = {
          status: "paid",
          payout_status: "awaiting_payout",
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId,
          stripe_status: "succeeded",
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
              .in("status", ["pending", "awaiting_payment"])
              .select("id");
          }

          return null;
        };

        let updateResult = await applyUpdate(fullPayload);

        if (!updateResult) {
          console.warn(
            "[stripe-webhook] checkout.session.completed missing booking identifiers; no update performed."
          );
        }

        if (updateResult && (!updateResult.data || updateResult.data.length === 0)) {
          updateResult = await supabaseAdmin
            .from("bookings")
            .update(fullPayload)
            .eq("stripe_checkout_session_id", session.id)
            .select("id");
        }

        if (updateResult?.error) {
          console.warn(
            "[stripe-webhook] detailed booking update failed, retrying with minimal payload:",
            updateResult.error
          );
          updateResult = await applyUpdate(fallbackPayload);
        }

        if (updateResult?.error) {
          // fallbackPayload already uses the correct status ("paid") and
          // already carries the Stripe identifiers -- if even this
          // minimal, schema-drift-tolerant payload fails, that's a
          // genuine unexpected error, not the now-fixed status-constraint
          // issue, so there is no further degraded payload to fall back
          // to. Log loudly rather than inventing another attempt.
          console.error("[stripe-webhook] failed to update booking even with minimal payload:", updateResult.error);
        } else if (updateResult && (!updateResult.data || updateResult.data.length === 0)) {
          console.warn("[stripe-webhook] booking update matched no rows. Ensure booking exists.");
        } else {
          const resolvedBookingId = updateResult?.data?.[0]?.id ?? bookingId ?? null;
          if (resolvedBookingId) {
            try {
              await sendBookingEmails({
                supabaseAdmin,
                bookingId: resolvedBookingId,
                stripeCheckoutSessionId: session.id,
                stripePaymentIntentId: paymentIntentId,
              });
            } catch (emailError) {
              console.warn("[stripe-webhook] booking email send failed:", emailError);
            }
          }
        }

        break;
      }

      case "checkout.session.expired": {
        // Inventory-reservation hold is capped at 30 minutes (both
        // Checkout Sessions now set expires_at accordingly). If the
        // guest never completed payment, release the provisional
        // booking (and, for shared stays, the pending member row) so
        // the dates/spot become bookable again. canExpireUnpaidCheckout
        // positively requires the row to still be an unpaid provisional
        // status AND stripe_status to not indicate a completed payment
        // -- it is not simply "not yet paid", so this can never touch a
        // paid/confirmed/completed/already-cancelled booking. The
        // .in("status", [...]) filter on the update itself is a second,
        // DB-level guard against a race with checkout.session.completed
        // finalizing the same booking between this read and this write.
        const session = event.data.object as any;
        const metadata = session?.metadata ?? {};
        const bookingId = metadata.booking_id ?? metadata.bookingId ?? null;

        if (bookingId) {
          const { data: bookingRow, error: bookingFetchError } = await supabaseAdmin
            .from("bookings")
            .select("id, status, stripe_status")
            .eq("id", bookingId)
            .maybeSingle();

          if (bookingFetchError) {
            console.error(
              "[stripe-webhook] failed to fetch booking for checkout.session.expired:",
              bookingFetchError
            );
          } else if (bookingRow && canExpireUnpaidCheckout(bookingRow.status, bookingRow.stripe_status)) {
            const { error: expireError } = await supabaseAdmin
              .from("bookings")
              .update({ status: "cancelled", stripe_status: "cancelled" })
              .eq("id", bookingId)
              .in("status", ["awaiting_payment", "pending_payment"]);

            if (expireError) {
              console.error("[stripe-webhook] failed to release expired checkout booking:", expireError);
            }
          }
        }

        // Shared-stay hygiene only -- capacity correctness does not
        // depend on this. Every occupancy computation (search.tsx, the
        // host calendar feed, and the enforce_shared_group_capacity /
        // refresh_shared_group_occupancy triggers) already treats a
        // pending shared_group_members row as inactive the moment its
        // own reservation_expires_at passes, independent of this
        // status flip. This just keeps the row from showing as a stale
        // "pending" hold in ops/host views. The .eq("status","pending")
        // filter ensures an already-confirmed member row is never
        // touched, even under a race with finalization.
        if (isSharedGroupCheckoutSession(session)) {
          const sharedGroupMemberId = metadata.shared_group_member_id ?? null;
          if (sharedGroupMemberId) {
            const { error: memberExpireError } = await supabaseAdmin
              .from("shared_group_members")
              .update({ status: "cancelled", updated_at: new Date().toISOString() })
              .eq("id", sharedGroupMemberId)
              .eq("status", "pending");

            if (memberExpireError) {
              console.error(
                "[stripe-webhook] failed to release expired shared group member hold:",
                memberExpireError
              );
            }
          }
        }

        break;
      }

      case "payment_intent.succeeded": {
        // Checkout handler above already manages booking state, but you could mirror status here if needed.
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as any;
        const paymentIntentId = paymentIntent?.id as string | undefined;
        if (!paymentIntentId) break;

        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            status: "payment_failed",
            stripe_status: paymentIntent?.status ?? "failed",
          })
          .eq("stripe_payment_intent_id", paymentIntentId);

        if (error) {
          console.error("[stripe-webhook] failed to mark payment_failed:", error);
          await supabaseAdmin
            .from("bookings")
            .update({
              status: "awaiting_payment",
              stripe_status: paymentIntent?.status ?? "failed",
            })
            .eq("stripe_payment_intent_id", paymentIntentId);
        }
        break;
      }

      case "account.updated": {
        const account = event.data.object as any;
        const accountId = account?.id as string | undefined;
        if (!accountId) break;

        const { error } = await supabaseAdmin
          .from("profiles")
          .update({
            stripe_onboarding_status: account?.details_submitted ? "complete" : "incomplete",
            charges_enabled: account?.charges_enabled === true,
            payouts_enabled: account?.payouts_enabled === true,
          })
          .eq("stripe_account_id", accountId);

        if (error) {
          console.error("[stripe-webhook] failed to update host profile:", error);
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

    // The handler above already completed successfully -- its side effects
    // (booking writes, emails, etc.) happened exactly once. Finalizing the
    // idempotency record is a small, bounded, retried step in its own
    // right, distinct from the handler itself: a transient DB blip here
    // must not be confused with a handler failure.
    const MARK_PROCESSED_MAX_ATTEMPTS = 3;
    const MARK_PROCESSED_RETRY_DELAY_MS = 250;

    let markedProcessed = false;
    let markProcessedError: any = null;

    for (let attempt = 1; attempt <= MARK_PROCESSED_MAX_ATTEMPTS; attempt++) {
      // Supabase/PostgREST does not return matched rows from an UPDATE
      // unless explicitly asked -- without .select(), an UPDATE that
      // matches zero rows (e.g. the "processing" filter no longer matches
      // for some unexpected reason) still comes back with error === null,
      // which would be indistinguishable from a real success. Require
      // exactly one returned row, for this event_id, to count as success.
      const { data: updatedRows, error } = await supabaseAdmin
        .from("processed_stripe_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("event_id", event.id)
        .eq("status", "processing")
        .select("event_id");

      if (!error && updatedRows?.length === 1 && updatedRows[0]?.event_id === event.id) {
        markedProcessed = true;
        break;
      }

      if (error) {
        markProcessedError = error;
        console.error(
          `[stripe-webhook] mark-processed attempt ${attempt}/${MARK_PROCESSED_MAX_ATTEMPTS} failed:`,
          error
        );
      } else if (!updatedRows || updatedRows.length === 0) {
        markProcessedError = new Error("mark-processed update matched no processing row");
        console.error(
          `[stripe-webhook] mark-processed attempt ${attempt}/${MARK_PROCESSED_MAX_ATTEMPTS} matched no processing row for event_id=${event.id}`
        );
      } else {
        markProcessedError = new Error("mark-processed update matched more than one row");
        console.error(
          `[stripe-webhook] mark-processed attempt ${attempt}/${MARK_PROCESSED_MAX_ATTEMPTS} matched ${updatedRows.length} rows for event_id=${event.id}, expected exactly 1`
        );
      }

      if (attempt < MARK_PROCESSED_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, MARK_PROCESSED_RETRY_DELAY_MS));
      }
    }

    if (!markedProcessed) {
      // All bounded attempts failed. Do not delete the "processing" row
      // here -- the handler already ran, so freeing the lock would let a
      // future delivery reacquire it and re-run the handler, duplicating
      // those side effects. Returning 5xx surfaces this as a failed
      // webhook for visibility; a later Stripe retry of this same event
      // will hit the existing-lock branch above (status still
      // "processing") and correctly return 409 without reprocessing, so
      // this state needs manual cleanup rather than resolving itself --
      // that's expected here, not a regression.
      console.error(
        "[stripe-webhook] handler side effects completed but idempotency record could not be finalized after",
        MARK_PROCESSED_MAX_ATTEMPTS,
        "attempts:",
        markProcessedError
      );
      return res.status(500).send("Webhook handler succeeded but idempotency finalization failed");
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("[stripe-webhook] handler error:", err);

    const { error: resetError } = await supabaseAdmin
      .from("processed_stripe_events")
      .delete()
      .eq("event_id", event.id);

    if (resetError) {
      console.error(
        "[stripe-webhook] failed to reset idempotency record after handler error:",
        resetError
      );
    }

    return res.status(500).send("Webhook handler error");
  }
}
