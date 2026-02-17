import type { NextApiRequest, NextApiResponse } from "next";
import { differenceInCalendarDays } from "date-fns";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { computeAllInPricing } from "@/lib/pricing";

type QuoteResponse = {
  nights: number;
  currency: "GBP";
  host_net_total_pence: number;
  guest_total_pence: number;
  guest_unit_price_pence: number;
  platform_fee_est_pence: number;
  platform_fee_capped: boolean;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: "all_in_v2_tiers_cap_firstfree";
};

const parseIsoDate = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<QuoteResponse | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { listingId, checkIn, checkOut } = req.body as {
    listingId?: string;
    checkIn?: string;
    checkOut?: string;
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

  const supabase = getSupabaseServerClient();
  const { data: listingRow, error: listingError } = await supabase
    .from("listings")
    .select("id, price_per_night, price_per_hour, booking_unit, rental_type")
    .eq("id", listingId)
    .maybeSingle();

  if (listingError) {
    console.error("[api/bookings/quote] failed to fetch listing", listingError);
    return res.status(500).json({ error: "Unable to load listing." });
  }

  if (!listingRow?.id) {
    return res.status(404).json({ error: "Listing not found." });
  }

  const isHourly =
    listingRow.booking_unit === "hourly" ||
    listingRow.rental_type === "day_use" ||
    listingRow.rental_type === "split_rest";

  if (isHourly) {
    return res.status(409).json({ error: "Hourly listings are not supported in quotes yet." });
  }

  const nightlyMajor = listingRow.price_per_night;
  if (nightlyMajor == null || Number(nightlyMajor) <= 0) {
    return res.status(409).json({ error: "Listing nightly price unavailable." });
  }

  const hostNetNightlyPence = Math.round(Number(nightlyMajor) * 100);
  const hostNetTotalPence = hostNetNightlyPence * nights;
  const pricing = computeAllInPricing({
    hostNetTotalPence,
    nights,
    isFirstCompletedBooking: false,
  });
  const guestUnitPricePence = computeAllInPricing({
    hostNetTotalPence: hostNetNightlyPence,
    nights,
    isFirstCompletedBooking: false,
  }).guest_total_pence;

  return res.status(200).json({
    nights,
    currency: "GBP",
    host_net_total_pence: hostNetTotalPence,
    guest_total_pence: pricing.guest_total_pence,
    guest_unit_price_pence: guestUnitPricePence,
    platform_fee_est_pence: pricing.platform_fee_est_pence,
    platform_fee_capped: pricing.platform_fee_capped,
    platform_fee_bps: pricing.platform_fee_bps,
    stripe_var_bps: pricing.stripe_var_bps,
    stripe_fixed_pence: pricing.stripe_fixed_pence,
    pricing_version: "all_in_v2_tiers_cap_firstfree",
  });
}
