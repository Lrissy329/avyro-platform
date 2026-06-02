export type FlexPricingPolicy = "incremental_only" | "reprice_on_threshold";
export type DiscountTierApplied = "none" | "weekly" | "monthly";

export type CalculateFlexChargeInput = {
  confirmedNights: number;
  extensionNights: number;
  alreadyPaidPence: number;
  nightlyRatePence: number;
  weeklyDiscountPct?: number | null;
  monthlyDiscountPct?: number | null;
  flexPricingPolicy?: FlexPricingPolicy | null;
  flexPricingMultiplier?: number | null;
};

export type CalculateFlexChargeOutput = {
  totalConfirmedStayValuePence: number;
  amountAlreadyPaidPence: number;
  amountDueNowPence: number;
  discountTierApplied: DiscountTierApplied;
  nightlyRateUsedForExtensionPence: number;
};

const clampInt = (value: number, min: number) => {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, parsed);
};

const clampPercent = (value?: number | null) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
};

const resolveTier = (nights: number, weeklyDiscountPct: number, monthlyDiscountPct: number) => {
  if (nights >= 28 && monthlyDiscountPct > 0) return "monthly" as const;
  if (nights >= 7 && weeklyDiscountPct > 0) return "weekly" as const;
  return "none" as const;
};

const applyDiscount = (baseNightlyPence: number, discountPct: number) =>
  Math.max(1, Math.round(baseNightlyPence * (1 - discountPct / 100)));

export function calculateFlexCharge(
  input: CalculateFlexChargeInput
): CalculateFlexChargeOutput {
  const confirmedNights = clampInt(input.confirmedNights, 0);
  const extensionNights = clampInt(input.extensionNights, 0);
  const baseNightlyPence = clampInt(input.nightlyRatePence, 1);
  const alreadyPaidPence = clampInt(input.alreadyPaidPence, 0);

  const policy: FlexPricingPolicy = input.flexPricingPolicy ?? "incremental_only";
  const multiplierRaw = Number(input.flexPricingMultiplier ?? 1);
  const multiplier =
    Number.isFinite(multiplierRaw) && multiplierRaw > 0
      ? Math.min(5, Math.max(1, multiplierRaw))
      : 1;

  const weeklyDiscountPct = clampPercent(input.weeklyDiscountPct);
  const monthlyDiscountPct = clampPercent(input.monthlyDiscountPct);

  const totalConfirmedNights = confirmedNights + extensionNights;
  const discountTierApplied = resolveTier(
    totalConfirmedNights,
    weeklyDiscountPct,
    monthlyDiscountPct
  );
  const tierDiscountPct =
    discountTierApplied === "monthly"
      ? monthlyDiscountPct
      : discountTierApplied === "weekly"
      ? weeklyDiscountPct
      : 0;

  if (policy === "reprice_on_threshold") {
    const repricedNightlyPence = applyDiscount(baseNightlyPence, tierDiscountPct);
    const repricedTotalPence = repricedNightlyPence * totalConfirmedNights;
    return {
      totalConfirmedStayValuePence: repricedTotalPence,
      amountAlreadyPaidPence: alreadyPaidPence,
      amountDueNowPence: Math.max(0, repricedTotalPence - alreadyPaidPence),
      discountTierApplied,
      nightlyRateUsedForExtensionPence: repricedNightlyPence,
    };
  }

  const extensionNightlyPence = Math.max(
    1,
    Math.round(baseNightlyPence * multiplier)
  );
  const extensionTotalPence = extensionNightlyPence * extensionNights;
  const totalConfirmedStayValuePence = alreadyPaidPence + extensionTotalPence;

  return {
    totalConfirmedStayValuePence,
    amountAlreadyPaidPence: alreadyPaidPence,
    amountDueNowPence: extensionTotalPence,
    discountTierApplied,
    nightlyRateUsedForExtensionPence: extensionNightlyPence,
  };
}
