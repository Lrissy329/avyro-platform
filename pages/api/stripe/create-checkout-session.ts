import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { computePricingFromMinor } from "@/lib/pricing";
import { createClient } from "@supabase/supabase-js";
import { differenceInCalendarDays, parseISO } from "date-fns";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase service role configuration for checkout handler.");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    const resolveOrigin = () => {
      const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
      if (envOrigin) return envOrigin.replace(/\/$/, "");
      const forwardedProto = (req.headers["x-forwarded-proto"] as string) ?? "https";
      const forwardedHost = (req.headers["x-forwarded-host"] as string) ?? req.headers.host;
      if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
      if (req.headers.origin) return req.headers.origin;
      return "http://localhost:3000";
    };

    const {
      bookingId,
      listingId,
      hostId,
      guestId,
      nights,
      pricePerUnit,
      successUrl,
      cancelUrl,
      checkInTime,
      checkOutTime,
      stayType,
      channel,
    } = req.body as {
      bookingId?: string;
      listingId?: string;
      hostId?: string;
      guestId?: string;
      nights?: number;
      pricePerUnit?: number;
      successUrl?: string;
      cancelUrl?: string;
      checkInTime?: string;
      checkOutTime?: string;
      stayType?: "nightly" | "day_use" | "split_rest" | "crashpad";
      channel?: "direct" | "airbnb" | "vrbo" | "bookingcom" | "expedia" | "manual" | "other";
    };

    if (!bookingId) {
      return res.status(400).json({ error: "bookingId is required" });
    }

    let resolvedListingId = listingId;
    let resolvedHostId = hostId;
    let resolvedGuestId = guestId;
    let resolvedNights = nights;
    let resolvedPricePerUnit = pricePerUnit;
    let resolvedCheckInTime = checkInTime;
    let resolvedCheckOutTime = checkOutTime;
    let resolvedStayType = stayType;
    let resolvedChannel = channel;
    let resolvedGuestTotalPence: number | null = null;

    const ensureBookingDetails = async () => {
      const { data, error } = await supabaseAdmin
        .from("bookings")
        .select(
          "id, listing_id, host_id, guest_id, check_in_time, check_out_time, stay_type, channel, price_total, currency, guest_total_pence"
        )
        .eq("id", bookingId)
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Booking not found");
      }

      resolvedListingId = resolvedListingId ?? (data.listing_id as string | undefined);
      resolvedHostId = resolvedHostId ?? (data.host_id as string | undefined);
      resolvedGuestId = resolvedGuestId ?? (data.guest_id as string | undefined);

      resolvedCheckInTime = resolvedCheckInTime ?? (data.check_in_time as string | undefined);
      resolvedCheckOutTime = resolvedCheckOutTime ?? (data.check_out_time as string | undefined);
      resolvedStayType = resolvedStayType ?? ((data.stay_type as any) || "nightly");
      resolvedChannel = resolvedChannel ?? ((data.channel as any) || "direct");
      resolvedGuestTotalPence =
        resolvedGuestTotalPence ??
        (typeof data.guest_total_pence === "number" ? data.guest_total_pence : null);

      if (!resolvedNights || resolvedNights <= 0) {
        if (resolvedCheckInTime && resolvedCheckOutTime) {
          const start = parseISO(resolvedCheckInTime);
          const end = parseISO(resolvedCheckOutTime);
          if (resolvedStayType === "day_use" || resolvedStayType === "split_rest") {
            const diffMs = end.getTime() - start.getTime();
            const rawHours = diffMs / (1000 * 60 * 60);
            resolvedNights = Math.max(0.5, Math.ceil(rawHours * 2) / 2);
          } else {
            const nightsDiff = differenceInCalendarDays(end, start);
            resolvedNights = Math.max(1, nightsDiff);
          }
        }
      }

      if (!resolvedPricePerUnit || resolvedPricePerUnit <= 0) {
        if (data.price_total && resolvedNights && resolvedNights > 0) {
          resolvedPricePerUnit = Math.max(
            1,
            Math.round(Number(data.price_total) / resolvedNights)
          );
        } else if (data.guest_total_pence && resolvedNights && resolvedNights > 0) {
          resolvedPricePerUnit = Math.max(
            1,
            Math.round(Number(data.guest_total_pence) / 100 / resolvedNights)
          );
        } else if (data.listing_id) {
          const { data: listingRow, error: listingErr } = await supabaseAdmin
            .from("listings")
            .select("price_per_night, price_per_hour")
            .eq("id", data.listing_id)
            .maybeSingle();
          if (!listingErr && listingRow) {
            const hourlyStay = resolvedStayType === "day_use" || resolvedStayType === "split_rest";
            if (hourlyStay && listingRow.price_per_hour != null) {
              resolvedPricePerUnit = Number(listingRow.price_per_hour);
            } else if (listingRow.price_per_night != null) {
              resolvedPricePerUnit = Number(listingRow.price_per_night);
            }
          }
        }
      }
    };

    if (
      !resolvedListingId ||
      !resolvedHostId ||
      !resolvedGuestId ||
      !resolvedNights ||
      resolvedNights <= 0 ||
      !resolvedPricePerUnit ||
      resolvedPricePerUnit <= 0
    ) {
      await ensureBookingDetails();
    }

    if (
      !resolvedListingId ||
      !resolvedHostId ||
      !resolvedGuestId ||
      !resolvedNights ||
      resolvedNights <= 0 ||
      !resolvedPricePerUnit ||
      resolvedPricePerUnit <= 0
    ) {
      return res.status(409).json({
        error: "Unable to determine booking amount. Please ensure the listing has a base rate.",
      });
    }
    resolvedStayType = resolvedStayType ?? "nightly";
    resolvedChannel = resolvedChannel ?? "direct";

    const { data: hostProfile, error: hostErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", resolvedHostId)
      .single();

    if (hostErr) return res.status(400).json({ error: hostErr.message });

    const destination = hostProfile?.stripe_account_id as string | null;
    if (!destination) {
      return res.status(409).json({ error: "Host not onboarded with Stripe yet." });
    }

    const isHourlyStay = resolvedStayType === "day_use" || resolvedStayType === "split_rest";
    const unitLabel = isHourlyStay ? "hour" : "night";
    const baseMinor = Math.round(resolvedPricePerUnit * resolvedNights * 100);
    let amount = resolvedGuestTotalPence ?? baseMinor;
    let applicationFeeAmount = 0;

    if (!resolvedGuestTotalPence && resolvedPricePerUnit && resolvedNights) {
      const pricing = computePricingFromMinor(baseMinor);
      amount = pricing.totalMinor;
      applicationFeeAmount = pricing.serviceFeeMinor;
    }

    const origin = resolveOrigin();

    const transferGroup = `booking_${bookingId}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "gbp",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: amount,
            product_data: {
              name: `Stay (${resolvedNights} ${unitLabel}${resolvedNights > 1 ? "s" : ""})`,
            },
          },
        },
      ],
      success_url:
        successUrl ?? `${origin}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl ?? `${origin}/booking/cancel`,
      payment_intent_data: {
        transfer_data: {
          destination,
        },
        application_fee_amount: applicationFeeAmount,
        on_behalf_of: destination,
        transfer_group: transferGroup,
        metadata: {
          booking_id: bookingId,
          listing_id: resolvedListingId,
          host_id: resolvedHostId,
          guest_id: resolvedGuestId,
          check_in_time: resolvedCheckInTime ?? "",
          check_out_time: resolvedCheckOutTime ?? "",
          stay_type: resolvedStayType,
          channel: resolvedChannel,
        },
      },
      metadata: {
        booking_id: bookingId,
        listingId: resolvedListingId,
        hostId: resolvedHostId,
        guestId: resolvedGuestId,
        transfer_group: transferGroup,
        checkInTime: resolvedCheckInTime ?? "",
        checkOutTime: resolvedCheckOutTime ?? "",
        stayType: resolvedStayType,
        channel: resolvedChannel,
      },
    });

    await supabaseAdmin
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        stripe_status: session.payment_status ?? "unpaid",
      })
      .eq("id", bookingId);

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (e: any) {
    console.error("[stripe] create checkout session error", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
