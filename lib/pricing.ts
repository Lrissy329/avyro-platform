export const DEFAULT_PLATFORM_FEE_BPS = 1200; // 12%
export const DEFAULT_STRIPE_VAR_BPS = 150; // 1.5%
export const DEFAULT_STRIPE_FIXED_PENCE = 20; // 20p
export const DEFAULT_MIN_GUEST_TOTAL_PENCE = 500; // £5.00

export type AllInPricing = {
  host_net_total_pence: number;
  guest_total_pence: number;
  platform_fee_est_pence: number;
  stripe_fee_est_pence: number;
  platform_margin_est_pence: number;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
};

const ceilDiv = (numerator: number, denominator: number) =>
  Math.floor((numerator + denominator - 1) / denominator);

const computeFeeEstimates = (
  guestTotalPence: number,
  hostNetTotalPence: number,
  platformFeeBps: number,
  stripeVarBps: number,
  stripeFixedPence: number
) => {
  const platformFeeEstPence = Math.floor((guestTotalPence * platformFeeBps) / 10000);
  const stripeFeeEstPence =
    Math.floor((guestTotalPence * stripeVarBps) / 10000) + stripeFixedPence;
  const platformMarginRaw = guestTotalPence - hostNetTotalPence - stripeFeeEstPence;
  return { platformFeeEstPence, stripeFeeEstPence, platformMarginRaw };
};

export function computeAllInPricing(params: {
  hostNetTotalPence: number;
  platformFeeBps?: number;
  stripeVarBps?: number;
  stripeFixedPence?: number;
  minGuestTotalPence?: number;
}): AllInPricing {
  const hostNetTotalPence = Math.max(0, Math.round(params.hostNetTotalPence));
  const platformFeeBps = params.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS;
  const stripeVarBps = params.stripeVarBps ?? DEFAULT_STRIPE_VAR_BPS;
  const stripeFixedPence = params.stripeFixedPence ?? DEFAULT_STRIPE_FIXED_PENCE;
  const minGuestTotalPence = params.minGuestTotalPence ?? DEFAULT_MIN_GUEST_TOTAL_PENCE;

  const denom = 10000 - platformFeeBps - stripeVarBps;
  if (denom <= 0) {
    throw new Error("Invalid fee configuration: denominator must be > 0");
  }

  const numerator = (hostNetTotalPence + stripeFixedPence) * 10000;
  let guestTotalPence = ceilDiv(numerator, denom);

  if (guestTotalPence < hostNetTotalPence + stripeFixedPence) {
    guestTotalPence = hostNetTotalPence + stripeFixedPence;
  }

  if (guestTotalPence < minGuestTotalPence) {
    guestTotalPence = minGuestTotalPence;
  }

  // Round guest total to nearest whole currency unit (GBP/EUR use 100 pence/cents).
  guestTotalPence = Math.round(guestTotalPence / 100) * 100;

  if (guestTotalPence < minGuestTotalPence) {
    guestTotalPence = minGuestTotalPence;
  }

  let { platformFeeEstPence, stripeFeeEstPence, platformMarginRaw } = computeFeeEstimates(
    guestTotalPence,
    hostNetTotalPence,
    platformFeeBps,
    stripeVarBps,
    stripeFixedPence
  );

  // If rounding down reduced margin below zero, bump by £1 until margin is non-negative.
  while (platformMarginRaw < 0) {
    guestTotalPence += 100;
    ({ platformFeeEstPence, stripeFeeEstPence, platformMarginRaw } = computeFeeEstimates(
      guestTotalPence,
      hostNetTotalPence,
      platformFeeBps,
      stripeVarBps,
      stripeFixedPence
    ));
  }

  const platformMarginEstPence = Math.max(platformMarginRaw, 0);

  return {
    host_net_total_pence: hostNetTotalPence,
    guest_total_pence: guestTotalPence,
    platform_fee_est_pence: platformFeeEstPence,
    stripe_fee_est_pence: stripeFeeEstPence,
    platform_margin_est_pence: platformMarginEstPence,
    platform_fee_bps: platformFeeBps,
    stripe_var_bps: stripeVarBps,
    stripe_fixed_pence: stripeFixedPence,
  };
}

export const computeGuestTotalPenceFromHostNet = (
  hostNetTotalPence: number,
  overrides?: {
    platformFeeBps?: number;
    stripeVarBps?: number;
    stripeFixedPence?: number;
    minGuestTotalPence?: number;
  }
) => computeAllInPricing({ hostNetTotalPence, ...overrides }).guest_total_pence;

export const computeGuestTotalMajorFromHostNet = (
  hostNetTotalMajor: number,
  overrides?: {
    platformFeeBps?: number;
    stripeVarBps?: number;
    stripeFixedPence?: number;
    minGuestTotalPence?: number;
  }
) =>
  computeGuestTotalPenceFromHostNet(Math.round(hostNetTotalMajor * 100), overrides) / 100;

// Legacy helpers (kept for backwards compatibility, now alias all-in pricing)
export type PricingBreakdownMinor = {
  baseMinor: number;
  serviceFeeMinor: number;
  stripeFeeMinor: number;
  totalMinor: number;
};

export type PricingBreakdown = {
  base: number;
  serviceFee: number;
  stripeFee: number;
  total: number;
};

export function computePricingFromMinor(baseMinor: number): PricingBreakdownMinor {
  const pricing = computeAllInPricing({ hostNetTotalPence: baseMinor });
  return {
    baseMinor,
    serviceFeeMinor: pricing.platform_fee_est_pence,
    stripeFeeMinor: pricing.stripe_fee_est_pence,
    totalMinor: pricing.guest_total_pence,
  };
}

export function computePricingFromMajor(base: number): PricingBreakdown {
  const baseMinor = Math.round(base * 100);
  const breakdown = computePricingFromMinor(baseMinor);
  return {
    base: breakdown.baseMinor / 100,
    serviceFee: breakdown.serviceFeeMinor / 100,
    stripeFee: breakdown.stripeFeeMinor / 100,
    total: breakdown.totalMinor / 100,
  };
}

export function getServiceFeeRate() {
  return DEFAULT_PLATFORM_FEE_BPS / 10000;
}
