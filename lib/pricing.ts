export const DEFAULT_PLATFORM_FEE_BPS = 1200; // 12%
export const DEFAULT_STRIPE_VAR_BPS = 150; // 1.5%
export const DEFAULT_STRIPE_FIXED_PENCE = 20; // 20p
export const DEFAULT_MIN_GUEST_TOTAL_PENCE = 500; // £5.00
export const PLATFORM_FEE_CAP_PENCE = 15000; // £150 cap

export type AllInPricing = {
  host_net_total_pence: number;
  guest_total_pence: number;
  platform_fee_est_pence: number;
  stripe_fee_est_pence: number;
  platform_margin_est_pence: number;
  platform_fee_capped: boolean;
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
  const platformFeeEstRaw = Math.floor((guestTotalPence * platformFeeBps) / 10000);
  const platformFeeEstPence = Math.min(platformFeeEstRaw, PLATFORM_FEE_CAP_PENCE);
  const platformFeeCapped = platformFeeEstRaw > PLATFORM_FEE_CAP_PENCE;
  const stripeFeeEstPence =
    Math.floor((guestTotalPence * stripeVarBps) / 10000) + stripeFixedPence;
  const platformMarginRaw = guestTotalPence - hostNetTotalPence - stripeFeeEstPence;
  return { platformFeeEstPence, platformFeeCapped, stripeFeeEstPence, platformMarginRaw };
};

export const getPlatformFeeBps = (params: {
  nights: number;
  isFirstCompletedBooking: boolean;
}): number => {
  if (params.isFirstCompletedBooking) return 0;
  if (params.nights >= 28) return 800;
  if (params.nights >= 7) return 1000;
  return 1200;
};

export function computeAllInPricing(params: {
  hostNetTotalPence: number;
  nights: number;
  isFirstCompletedBooking?: boolean;
  platformFeeBps?: number;
  stripeVarBps?: number;
  stripeFixedPence?: number;
  minGuestTotalPence?: number;
}): AllInPricing {
  const hostNetTotalPence = Math.max(0, Math.round(params.hostNetTotalPence));
  const nights = Math.max(1, Math.floor(params.nights));
  const isFirstCompletedBooking = Boolean(params.isFirstCompletedBooking);
  const platformFeeBps =
    params.platformFeeBps ??
    getPlatformFeeBps({ nights, isFirstCompletedBooking });
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

  let { platformFeeEstPence, platformFeeCapped, stripeFeeEstPence, platformMarginRaw } =
    computeFeeEstimates(
    guestTotalPence,
    hostNetTotalPence,
    platformFeeBps,
    stripeVarBps,
    stripeFixedPence
  );

  // If rounding down reduced margin below zero, bump by £1 until margin is non-negative.
  let guard = 0;
  while (platformMarginRaw < 0 && guard < 100) {
    guestTotalPence += 100;
    ({ platformFeeEstPence, platformFeeCapped, stripeFeeEstPence, platformMarginRaw } =
      computeFeeEstimates(
      guestTotalPence,
      hostNetTotalPence,
      platformFeeBps,
      stripeVarBps,
      stripeFixedPence
    ));
    guard += 1;
  }

  if (platformMarginRaw < 0) {
    throw new Error("Pricing margin could not be resolved with guard limit.");
  }

  const platformMarginEstPence = Math.max(platformMarginRaw, 0);

  return {
    host_net_total_pence: hostNetTotalPence,
    guest_total_pence: guestTotalPence,
    platform_fee_est_pence: platformFeeEstPence,
    stripe_fee_est_pence: stripeFeeEstPence,
    platform_margin_est_pence: platformMarginEstPence,
    platform_fee_capped: platformFeeCapped,
    platform_fee_bps: platformFeeBps,
    stripe_var_bps: stripeVarBps,
    stripe_fixed_pence: stripeFixedPence,
  };
}

export const computeGuestTotalPenceFromHostNet = (
  hostNetTotalPence: number,
  overrides?: {
    nights?: number;
    isFirstCompletedBooking?: boolean;
    platformFeeBps?: number;
    stripeVarBps?: number;
    stripeFixedPence?: number;
    minGuestTotalPence?: number;
  }
) =>
  computeAllInPricing({
    hostNetTotalPence,
    nights: overrides?.nights ?? 1,
    isFirstCompletedBooking: overrides?.isFirstCompletedBooking ?? false,
    ...overrides,
  }).guest_total_pence;

export const computeGuestTotalMajorFromHostNet = (
  hostNetTotalMajor: number,
  overrides?: {
    nights?: number;
    isFirstCompletedBooking?: boolean;
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
  const pricing = computeAllInPricing({
    hostNetTotalPence: baseMinor,
    nights: 1,
    isFirstCompletedBooking: false,
  });
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
