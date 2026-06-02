import type { NextApiRequest, NextApiResponse } from "next";
import { computeRoundedGuestPricing } from "@/lib/pricing";

type HostQuoteResponse = {
  currency: "GBP";
  host_net_nightly_pence: number;
  guest_unit_price_pence: number;
  raw_guest_unit_price_pence: number;
  rounding_adjustment_pence: number;
  platform_fee_est_pence: number;
  platform_fee_capped: boolean;
  stripe_fee_est_pence: number;
  platform_margin_est_pence: number;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: "all_in_v2_tiers_cap_firstfree";
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HostQuoteResponse | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { hostNetNightlyPence, nights, isFirstCompletedBooking } = req.body as {
    hostNetNightlyPence?: number;
    nights?: number;
    isFirstCompletedBooking?: boolean;
  };

  if (!Number.isInteger(hostNetNightlyPence) || hostNetNightlyPence <= 0) {
    return res.status(400).json({ error: "hostNetNightlyPence must be a positive integer." });
  }

  const resolvedNights = Number.isFinite(Number(nights)) ? Math.max(1, Math.floor(Number(nights))) : 1;
  const pricing = computeRoundedGuestPricing({
    hostUnitPence: hostNetNightlyPence,
    units: 1,
    nightsForFeeTier: resolvedNights,
    isFirstCompletedBooking: Boolean(isFirstCompletedBooking),
  });

  return res.status(200).json({
    currency: "GBP",
    host_net_nightly_pence: hostNetNightlyPence,
    guest_unit_price_pence: pricing.rounded_guest_unit_pence,
    raw_guest_unit_price_pence: pricing.raw_guest_unit_pence,
    rounding_adjustment_pence: pricing.rounding_adjustment_pence,
    platform_fee_est_pence: pricing.platform_fee_pence,
    platform_fee_capped: pricing.platform_fee_capped,
    stripe_fee_est_pence: pricing.payment_fee_est_pence,
    platform_margin_est_pence: pricing.platform_margin_pence,
    platform_fee_bps: pricing.platform_fee_bps,
    stripe_var_bps: pricing.stripe_var_bps,
    stripe_fixed_pence: pricing.stripe_fixed_pence,
    pricing_version: "all_in_v2_tiers_cap_firstfree",
  });
}
