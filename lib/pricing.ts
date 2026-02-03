const SERVICE_FEE_RATE = 0.06;
const STRIPE_PERCENT_FEE = 0.029;
const STRIPE_FIXED_FEE_MINOR = 20; // 20p

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
  const serviceFeeMinor = Math.round(baseMinor * SERVICE_FEE_RATE);
  const netAfterService = baseMinor + serviceFeeMinor;
  const totalMinor = Math.ceil((netAfterService + STRIPE_FIXED_FEE_MINOR) / (1 - STRIPE_PERCENT_FEE));
  const stripeFeeMinor = totalMinor - netAfterService;

  return {
    baseMinor,
    serviceFeeMinor,
    stripeFeeMinor,
    totalMinor,
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
  return SERVICE_FEE_RATE;
}
