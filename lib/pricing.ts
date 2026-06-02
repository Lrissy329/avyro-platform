export const DEFAULT_PLATFORM_FEE_BPS = 1200; // 12%
export const DEFAULT_STRIPE_VAR_BPS = 150; // 1.5%
export const DEFAULT_STRIPE_FIXED_PENCE = 20; // 20p
export const DEFAULT_MIN_GUEST_TOTAL_PENCE = 500; // £5.00
export const PLATFORM_FEE_CAP_PENCE = 15000; // £150 cap
export const DEFAULT_GUEST_PRICE_ROUNDING_BAND_PENCE = 500; // £5.00

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

export type GuestStayPricing = AllInPricing & {
  units: number;
  guest_unit_avg_pence: number;
  guest_unit_avg_major: number;
  guest_total_major: number;
};

export type RoundedGuestPricing = {
  host_unit_pence: number;
  units: number;
  nights_for_fee_tier: number;
  host_total_pence: number;
  raw_guest_total_pence: number;
  raw_guest_unit_pence: number;
  rounded_guest_unit_pence: number;
  total_guest_pence: number;
  platform_fee_pence: number;
  payment_fee_est_pence: number;
  platform_margin_pence: number;
  platform_fee_capped: boolean;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  rounding_adjustment_pence: number;
};

const ceilDiv = (numerator: number, denominator: number) =>
  Math.floor((numerator + denominator - 1) / denominator);

const roundUpToBand = (valuePence: number, bandPence: number) => {
  if (bandPence <= 1) return Math.max(0, Math.round(valuePence));
  return ceilDiv(Math.max(0, Math.round(valuePence)), bandPence) * bandPence;
};

export const roundGuestPricePenceToNearestFivePounds = (pricePence: number) =>
  roundUpToBand(pricePence, DEFAULT_GUEST_PRICE_ROUNDING_BAND_PENCE);

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

const solveRawGuestTotalPence = (params: {
  hostNetTotalPence: number;
  nights: number;
  isFirstCompletedBooking?: boolean;
  platformFeeBps?: number;
  stripeVarBps?: number;
  stripeFixedPence?: number;
  minGuestTotalPence?: number;
}) => {
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
  let rawGuestTotalPence = ceilDiv(numerator, denom);

  if (rawGuestTotalPence < hostNetTotalPence + stripeFixedPence) {
    rawGuestTotalPence = hostNetTotalPence + stripeFixedPence;
  }

  if (rawGuestTotalPence < minGuestTotalPence) {
    rawGuestTotalPence = minGuestTotalPence;
  }

  let {
    platformFeeEstPence,
    platformFeeCapped,
    stripeFeeEstPence,
    platformMarginRaw,
  } = computeFeeEstimates(
    rawGuestTotalPence,
    hostNetTotalPence,
    platformFeeBps,
    stripeVarBps,
    stripeFixedPence
  );

  let guard = 0;
  while (platformMarginRaw < 0 && guard < 1000) {
    rawGuestTotalPence += 1;
    ({
      platformFeeEstPence,
      platformFeeCapped,
      stripeFeeEstPence,
      platformMarginRaw,
    } = computeFeeEstimates(
      rawGuestTotalPence,
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

  return {
    hostNetTotalPence,
    nights,
    platformFeeBps,
    stripeVarBps,
    stripeFixedPence,
    rawGuestTotalPence,
    platformFeeEstPence,
    platformFeeCapped,
    stripeFeeEstPence,
    platformMarginRaw,
  };
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
  guestPriceRoundingBandPence?: number;
}): AllInPricing {
  const raw = solveRawGuestTotalPence(params);
  const roundingBandPence = Math.max(
    1,
    Math.round(params.guestPriceRoundingBandPence ?? DEFAULT_GUEST_PRICE_ROUNDING_BAND_PENCE)
  );
  let guestTotalPence = roundUpToBand(raw.rawGuestTotalPence, roundingBandPence);
  let { platformFeeEstPence, platformFeeCapped, stripeFeeEstPence, platformMarginRaw } =
    computeFeeEstimates(
      guestTotalPence,
      raw.hostNetTotalPence,
      raw.platformFeeBps,
      raw.stripeVarBps,
      raw.stripeFixedPence
    );

  let guard = 0;
  while (platformMarginRaw < 0 && guard < 100) {
    guestTotalPence += roundingBandPence;
    ({ platformFeeEstPence, platformFeeCapped, stripeFeeEstPence, platformMarginRaw } =
      computeFeeEstimates(
        guestTotalPence,
        raw.hostNetTotalPence,
        raw.platformFeeBps,
        raw.stripeVarBps,
        raw.stripeFixedPence
      ));
    guard += 1;
  }

  if (platformMarginRaw < 0) {
    throw new Error("Pricing margin could not be resolved with guard limit.");
  }

  const platformMarginEstPence = Math.max(platformMarginRaw, 0);

  return {
    host_net_total_pence: raw.hostNetTotalPence,
    guest_total_pence: guestTotalPence,
    platform_fee_est_pence: platformFeeEstPence,
    stripe_fee_est_pence: stripeFeeEstPence,
    platform_margin_est_pence: platformMarginEstPence,
    platform_fee_capped: platformFeeCapped,
    platform_fee_bps: raw.platformFeeBps,
    stripe_var_bps: raw.stripeVarBps,
    stripe_fixed_pence: raw.stripeFixedPence,
  };
}

export function computeRoundedGuestPricing(params: {
  hostUnitPence: number;
  units: number;
  nightsForFeeTier?: number;
  isFirstCompletedBooking?: boolean;
  platformFeeBps?: number;
  stripeVarBps?: number;
  stripeFixedPence?: number;
  minGuestTotalPence?: number;
  roundingBandPence?: number;
}): RoundedGuestPricing {
  const units = Math.max(1, Math.round(params.units));
  const hostUnitPence = Math.max(0, Math.round(params.hostUnitPence));
  const hostTotalPence = hostUnitPence * units;
  const nightsForFeeTier = Math.max(1, Math.round(params.nightsForFeeTier ?? units));
  const roundingBandPence = Math.max(
    1,
    Math.round(params.roundingBandPence ?? DEFAULT_GUEST_PRICE_ROUNDING_BAND_PENCE)
  );

  const raw = solveRawGuestTotalPence({
    hostNetTotalPence: hostTotalPence,
    nights: nightsForFeeTier,
    isFirstCompletedBooking: params.isFirstCompletedBooking,
    platformFeeBps: params.platformFeeBps,
    stripeVarBps: params.stripeVarBps,
    stripeFixedPence: params.stripeFixedPence,
    minGuestTotalPence: params.minGuestTotalPence,
  });

  const rawGuestUnitPence = ceilDiv(raw.rawGuestTotalPence, units);
  let roundedGuestUnitPence = roundUpToBand(rawGuestUnitPence, roundingBandPence);
  let totalGuestPence = roundedGuestUnitPence * units;
  let {
    platformFeeEstPence,
    platformFeeCapped,
    stripeFeeEstPence,
    platformMarginRaw,
  } = computeFeeEstimates(
    totalGuestPence,
    hostTotalPence,
    raw.platformFeeBps,
    raw.stripeVarBps,
    raw.stripeFixedPence
  );

  let guard = 0;
  while (platformMarginRaw < 0 && guard < 100) {
    roundedGuestUnitPence += roundingBandPence;
    totalGuestPence = roundedGuestUnitPence * units;
    ({
      platformFeeEstPence,
      platformFeeCapped,
      stripeFeeEstPence,
      platformMarginRaw,
    } = computeFeeEstimates(
      totalGuestPence,
      hostTotalPence,
      raw.platformFeeBps,
      raw.stripeVarBps,
      raw.stripeFixedPence
    ));
    guard += 1;
  }

  if (platformMarginRaw < 0) {
    throw new Error("Rounded pricing margin could not be resolved with guard limit.");
  }

  return {
    host_unit_pence: hostUnitPence,
    units,
    nights_for_fee_tier: nightsForFeeTier,
    host_total_pence: hostTotalPence,
    raw_guest_total_pence: raw.rawGuestTotalPence,
    raw_guest_unit_pence: rawGuestUnitPence,
    rounded_guest_unit_pence: roundedGuestUnitPence,
    total_guest_pence: totalGuestPence,
    platform_fee_pence: platformFeeEstPence,
    payment_fee_est_pence: stripeFeeEstPence,
    platform_margin_pence: Math.max(0, platformMarginRaw),
    platform_fee_capped: platformFeeCapped,
    platform_fee_bps: raw.platformFeeBps,
    stripe_var_bps: raw.stripeVarBps,
    stripe_fixed_pence: raw.stripeFixedPence,
    rounding_adjustment_pence: totalGuestPence - raw.rawGuestTotalPence,
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

export function computeGuestStayPricing(params: {
  hostNetUnitMajor: number;
  units: number;
  bookingUnit?: "nightly" | "hourly";
  isFirstCompletedBooking?: boolean;
  platformFeeBps?: number;
  stripeVarBps?: number;
  stripeFixedPence?: number;
  minGuestTotalPence?: number;
}): GuestStayPricing {
  const bookingUnit = params.bookingUnit === "hourly" ? "hourly" : "nightly";
  const minUnits = bookingUnit === "hourly" ? 0.5 : 1;
  const units = Math.max(minUnits, params.units);
  const hostNetUnitPence = Math.round(params.hostNetUnitMajor * 100);
  const hostNetTotalPence = Math.round(params.hostNetUnitMajor * units * 100);
  const nights =
    bookingUnit === "hourly" ? 1 : Math.max(1, Math.ceil(units));
  const canUseUnitRounding = Number.isInteger(units) && units >= 1;
  const unitRounded = canUseUnitRounding
    ? computeRoundedGuestPricing({
        hostUnitPence: hostNetUnitPence,
        units: Math.round(units),
        nightsForFeeTier: nights,
        isFirstCompletedBooking: params.isFirstCompletedBooking ?? false,
        platformFeeBps: params.platformFeeBps,
        stripeVarBps: params.stripeVarBps,
        stripeFixedPence: params.stripeFixedPence,
        minGuestTotalPence: params.minGuestTotalPence,
      })
    : null;
  const pricing = unitRounded
    ? {
        host_net_total_pence: hostNetTotalPence,
        guest_total_pence: unitRounded.total_guest_pence,
        platform_fee_est_pence: unitRounded.platform_fee_pence,
        stripe_fee_est_pence: unitRounded.payment_fee_est_pence,
        platform_margin_est_pence: unitRounded.platform_margin_pence,
        platform_fee_capped: unitRounded.platform_fee_capped,
        platform_fee_bps: unitRounded.platform_fee_bps,
        stripe_var_bps: unitRounded.stripe_var_bps,
        stripe_fixed_pence: unitRounded.stripe_fixed_pence,
      }
    : computeAllInPricing({
        hostNetTotalPence,
        nights,
        isFirstCompletedBooking: params.isFirstCompletedBooking ?? false,
        platformFeeBps: params.platformFeeBps,
        stripeVarBps: params.stripeVarBps,
        stripeFixedPence: params.stripeFixedPence,
        minGuestTotalPence: params.minGuestTotalPence,
      });

  const guestUnitAvgPence = unitRounded
    ? unitRounded.rounded_guest_unit_pence
    : Math.round(pricing.guest_total_pence / units);
  return {
    ...pricing,
    units,
    guest_unit_avg_pence: guestUnitAvgPence,
    guest_unit_avg_major: guestUnitAvgPence / 100,
    guest_total_major: pricing.guest_total_pence / 100,
  };
}

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

export function computeSharedPerPersonWeeklyPricePence(params: {
  totalWeeklyPricePence: number;
  totalSpots: number;
  roundingBandPence?: number;
}) {
  const totalWeeklyPricePence = Math.max(0, Math.round(params.totalWeeklyPricePence));
  const totalSpots = Math.max(1, Math.round(params.totalSpots));
  const rawPerPersonWeeklyPence = ceilDiv(totalWeeklyPricePence, totalSpots);
  const roundingBandPence = Math.max(
    1,
    Math.round(params.roundingBandPence ?? DEFAULT_GUEST_PRICE_ROUNDING_BAND_PENCE)
  );
  const roundedPerPersonWeeklyPence = roundUpToBand(rawPerPersonWeeklyPence, roundingBandPence);
  return {
    raw_per_person_weekly_pence: rawPerPersonWeeklyPence,
    rounded_per_person_weekly_pence: roundedPerPersonWeeklyPence,
    rounding_adjustment_pence:
      roundedPerPersonWeeklyPence * totalSpots - totalWeeklyPricePence,
  };
}
