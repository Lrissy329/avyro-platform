import type { NextApiRequest, NextApiResponse } from "next";
import { computeAllInPricing } from "@/lib/pricing";

type HostQuoteResponse = {
  currency: "GBP";
  host_net_nightly_pence: number;
  guest_unit_price_pence: number;
  platform_fee_est_pence: number;
  stripe_fee_est_pence: number;
  platform_margin_est_pence: number;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: "all_in_v1";
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HostQuoteResponse | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { hostNetNightlyPence } = req.body as {
    hostNetNightlyPence?: number;
  };

  if (!Number.isInteger(hostNetNightlyPence) || hostNetNightlyPence <= 0) {
    return res.status(400).json({ error: "hostNetNightlyPence must be a positive integer." });
  }

  const pricing = computeAllInPricing({ hostNetTotalPence: hostNetNightlyPence });

  return res.status(200).json({
    currency: "GBP",
    host_net_nightly_pence: hostNetNightlyPence,
    guest_unit_price_pence: pricing.guest_total_pence,
    platform_fee_est_pence: pricing.platform_fee_est_pence,
    stripe_fee_est_pence: pricing.stripe_fee_est_pence,
    platform_margin_est_pence: pricing.platform_margin_est_pence,
    platform_fee_bps: pricing.platform_fee_bps,
    stripe_var_bps: pricing.stripe_var_bps,
    stripe_fixed_pence: pricing.stripe_fixed_pence,
    pricing_version: "all_in_v1",
  });
}
