import type { NextApiRequest, NextApiResponse } from "next";
import { differenceInCalendarDays } from "date-fns";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { computeAllInPricing } from "@/lib/pricing";
import { stripe } from "@/lib/stripe";
import type { BookingStayType } from "@/lib/calendarTypes";

const STAY_TYPES: BookingStayType[] = ["nightly", "day_use", "split_rest", "crashpad"];

const parseIsoDate = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
};

const resolveStayType = (listing: {
  rental_type?: string | null;
  booking_unit?: string | null;
}): BookingStayType => {
  if (listing.rental_type === "day_use") return "day_use";
  if (listing.rental_type === "split_rest") return "split_rest";
  if (listing.rental_type === "crashpad") return "crashpad";
  if (listing.booking_unit === "hourly") return "day_use";
  return "nightly";
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    | {
        bookingId: string;
        checkoutUrl: string;
      }
    | { error: string; code?: string; requiredLevel?: number }
  >
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const resolveOrigin = () => {
    const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
    if (envOrigin) return envOrigin.replace(/\/$/, "");
    const forwardedProto = (req.headers["x-forwarded-proto"] as string) ?? "https";
    const forwardedHost = (req.headers["x-forwarded-host"] as string) ?? req.headers.host;
    if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
    if (req.headers.origin) return req.headers.origin;
    return "http://localhost:3000";
  };

  const supabase = getSupabaseServerClient();
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace(/Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  const { listingId, checkIn, checkOut, guests } = req.body as {
    listingId?: string;
    checkIn?: string;
    checkOut?: string;
    guests?: number;
  };

  if (!listingId || !checkIn || !checkOut) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const checkInDate = parseIsoDate(checkIn);
  const checkOutDate = parseIsoDate(checkOut);
  if (!checkInDate || !checkOutDate) {
    return res.status(400).json({ error: "Invalid dates." });
  }

  if (checkOutDate <= checkInDate) {
    return res.status(400).json({ error: "checkOut must be after checkIn." });
  }

  const nights = differenceInCalendarDays(checkOutDate, checkInDate);
  if (nights < 1) {
    return res.status(400).json({ error: "Nightly stays must be at least one night." });
  }

  const { data: listingRow, error: listingError } = await supabase
    .from("listings")
    .select(
      "id, user_id, title, rental_type, booking_unit, is_instant_book, is_crew_ready, price_per_night, price_per_hour"
    )
    .eq("id", listingId)
    .maybeSingle();

  if (listingError) {
    console.error("[api/bookings/create] failed to fetch listing", listingError);
    return res.status(500).json({ error: "Unable to load listing." });
  }

  if (!listingRow?.user_id) {
    return res.status(404).json({ error: "Listing not found." });
  }

  const stayType = resolveStayType(listingRow);
  if (!STAY_TYPES.includes(stayType)) {
    return res.status(400).json({ error: "Stay type not available for this listing." });
  }

  const isInstantBook = Boolean((listingRow as any).is_instant_book);
  const isCrewReady = Boolean((listingRow as any).is_crew_ready);
  let requiredLevel = 0;
  if (isInstantBook) {
    requiredLevel = isCrewReady ? 2 : 1;
    if (nights >= 14) requiredLevel = 2;
  }

  if (requiredLevel > 0) {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("verification_level")
      .eq("id", userData.user.id)
      .maybeSingle();
    const level = Number(profileRow?.verification_level) || 0;
    if (level < requiredLevel) {
      return res
        .status(403)
        .json({ code: "VERIFICATION_REQUIRED", requiredLevel, error: "Verification required." });
    }
  }

  const isHourly =
    listingRow.booking_unit === "hourly" ||
    listingRow.rental_type === "day_use" ||
    listingRow.rental_type === "split_rest";

  if (isHourly) {
    return res.status(409).json({ error: "Hourly listings are not supported yet." });
  }

  const nightlyMajor = listingRow.price_per_night;
  if (nightlyMajor == null || Number(nightlyMajor) <= 0) {
    return res.status(409).json({ error: "Listing nightly price unavailable." });
  }

  let isFirstCompletedBooking = false;
  if (listingRow.user_id) {
    const { count, error: bookingCountError } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("host_id", listingRow.user_id)
      .in("status", ["confirmed", "completed"]);
    if (bookingCountError) {
      console.error("[api/bookings/create] failed to check host bookings", bookingCountError);
    } else {
      isFirstCompletedBooking = (count ?? 0) === 0;
    }
  }

  const hostNetNightlyPence = Math.round(Number(nightlyMajor) * 100);
  const hostNetTotalPence = hostNetNightlyPence * nights;
  const pricing = computeAllInPricing({
    hostNetTotalPence,
    nights,
    isFirstCompletedBooking,
  });
  const guestUnitPricePence = computeAllInPricing({
    hostNetTotalPence: hostNetNightlyPence,
    nights,
    isFirstCompletedBooking,
  }).guest_total_pence;

  const checkInTimeIso = new Date(`${checkIn}T00:00:00Z`).toISOString();
  const checkOutTimeIso = new Date(`${checkOut}T00:00:00Z`).toISOString();

  const payload: Record<string, any> = {
    listing_id: listingId,
    host_id: listingRow.user_id,
    guest_id: userData.user.id,
    status: "awaiting_payment",
    stay_type: stayType,
    channel: "direct",
    check_in_time: checkInTimeIso,
    check_out_time: checkOutTimeIso,
    nights,
    currency: "GBP",
    price_total: pricing.guest_total_pence / 100,
    host_net_total_pence: hostNetTotalPence,
    guest_total_pence: pricing.guest_total_pence,
    guest_unit_price_pence: guestUnitPricePence,
    platform_fee_bps: pricing.platform_fee_bps,
    stripe_var_bps: pricing.stripe_var_bps,
    stripe_fixed_pence: pricing.stripe_fixed_pence,
    pricing_version: "all_in_v2_tiers_cap_firstfree",
  };

  if (typeof guests === "number") {
    payload.guests_total = guests;
  }

  const { data: bookingRow, error: bookingError } = await supabase
    .from("bookings")
    .insert(payload)
    .select()
    .single();

  if (bookingError || !bookingRow?.id) {
    console.error("[api/bookings/create] failed to create booking", bookingError);
    return res.status(400).json({ error: bookingError?.message ?? "Failed to create booking." });
  }

  const guestTotalPence = bookingRow.guest_total_pence;
  if (!Number.isInteger(guestTotalPence)) {
    console.error("[api/bookings/create] guest_total_pence is not integer", guestTotalPence);
    return res.status(500).json({ error: "guest_total_pence must be integer pence." });
  }

  const origin = resolveOrigin();
  const successUrl = `${origin}/booking/success?booking=${bookingRow.id}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/listing/${listingId}?payment=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    currency: String(bookingRow.currency ?? "GBP").toLowerCase(),
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: String(bookingRow.currency ?? "GBP").toLowerCase(),
          unit_amount: guestTotalPence,
          product_data: {
            name: listingRow.title
              ? `Stay at ${listingRow.title}`
              : "Stay booking",
          },
        },
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      booking_id: bookingRow.id,
      listing_id: listingId,
      host_id: listingRow.user_id,
      guest_id: userData.user.id,
    },
  });

  await supabase
    .from("bookings")
    .update({
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      stripe_status: session.payment_status ?? "unpaid",
    })
    .eq("id", bookingRow.id);

  if (!session.url) {
    return res.status(500).json({ error: "Checkout session missing redirect URL." });
  }

  return res.status(200).json({
    bookingId: bookingRow.id,
    checkoutUrl: session.url,
  });
}
