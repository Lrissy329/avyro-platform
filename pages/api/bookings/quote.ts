import type { NextApiRequest, NextApiResponse } from "next";
import { differenceInCalendarDays } from "date-fns";
import { evaluateFlexAvailability, type FlexMode } from "@/lib/flexAvailability";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  computeRoundedGuestPricing,
  roundGuestPricePenceToNearestFivePounds,
} from "@/lib/pricing";
import type { DiscountTierApplied, FlexPricingPolicy } from "@/lib/flexPricing";

type QuoteResponse = {
  nights: number;
  currency: "GBP";
  host_net_total_pence: number;
  guest_total_pence: number;
  guest_unit_price_pence: number;
  raw_guest_unit_price_pence: number;
  rounding_adjustment_pence: number;
  platform_fee_est_pence: number;
  platform_fee_capped: boolean;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: "all_in_v2_tiers_cap_firstfree";
  flex_extra_night_allowed: boolean;
  flex_extra_night_price_pence: number | null;
  flex_extra_night_modifier_pct: number;
  flex_extension_notice_hours: number;
  flex_extension_pricing_mode: "same_rate" | "premium_10";
  flex_max_extension_nights: number;
  flex_mode_default: FlexMode;
  rolling_flex_allowed: boolean;
  rolling_window_days: number;
  rolling_min_commitment_nights: number;
  rolling_max_extension_nights: number;
  flex_pricing_multiplier: number;
  rolling_extension_unit_price_pence: number | null;
  flex_pricing_policy: FlexPricingPolicy;
  discount_tier_applied: DiscountTierApplied;
  amount_due_today_pence: number;
  base_available: boolean;
  extra_night_available: boolean;
  rolling_flex_available: boolean;
  rolling_flex_window_days_available: number;
  rolling_flex_max_extension_nights_supported: number;
};

const parseIsoDate = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
};

const isMissingRelation = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42p01" ||
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("relation") ||
    message.includes("host_settings") ||
    message.includes("schema cache") ||
    message.includes("allow_flexible_stays") ||
    (message.includes("column") && message.includes("does not exist"))
  );
};
const ENABLE_API_DEBUG =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEBUG_BOOKING_WIDGET === "1";

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
    bookingMode?: FlexMode;
    flexMinNights?: number;
    flexMaxNights?: number;
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

  const rangeNights = differenceInCalendarDays(checkOutDate, checkInDate);
  if (rangeNights < 1) {
    return res.status(400).json({ error: "Nightly stays must be at least one night." });
  }

  const supabase = getSupabaseServerClient();
  const listingSelects = [
    "id, user_id, price_per_night, price_per_hour, booking_unit, rental_type, is_shared_stay, allow_flexible_stays, flexible_stay_mode, flex_min_commitment_nights, flex_max_extension_nights, flex_extension_notice_hours, flex_extension_pricing_mode, flex_rolling_window_days, flex_pricing_multiplier",
    "id, user_id, price_per_night, price_per_hour, booking_unit, rental_type, is_shared_stay, allow_flexible_stays, flex_max_extension_nights, flex_extension_notice_hours, flex_extension_pricing_mode",
    "id, user_id, price_per_night, price_per_hour, booking_unit, rental_type, is_shared_stay",
    "id, user_id, price_per_night, price_per_hour, booking_unit, rental_type",
  ];

  let listingRow: any = null;
  let listingError: any = null;
  for (const select of listingSelects) {
    const result = await supabase
      .from("listings")
      .select(select)
      .eq("id", listingId)
      .maybeSingle();
    listingRow = result.data ?? null;
    listingError = result.error;
    if (!listingError) break;
    if (!isMissingRelation(listingError)) break;
  }

  if (listingError) {
    console.error("[api/bookings/quote] failed to fetch listing", listingError);
    return res.status(500).json({ error: "Unable to load listing." });
  }

  if (!listingRow?.id) {
    return res.status(404).json({ error: "Listing not found." });
  }
  if (Boolean((listingRow as any).is_shared_stay)) {
    return res.status(409).json({
      error: "Shared stays use group checkout pricing.",
    });
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

  const listingAllowsFlexibleStays = (listingRow as any).allow_flexible_stays ?? false;
  const configuredMode = String((listingRow as any).flexible_stay_mode ?? "").toLowerCase();
  const configuredFlexMode: FlexMode =
    !listingAllowsFlexibleStays
      ? "none"
      : configuredMode === "rolling"
      ? "rolling"
      : configuredMode === "extra_night"
      ? "extra_night"
      : "none";
  const supportsFlexibleModes = listingAllowsFlexibleStays && configuredFlexMode !== "none";
  const supportsExtraNight = supportsFlexibleModes;
  const supportsRolling = supportsFlexibleModes;
  const defaultFlexMode: FlexMode = !supportsFlexibleModes
    ? "none"
    : rangeNights >= 7
    ? "rolling"
    : "extra_night";
  const hasBookingMode = typeof req.body?.bookingMode === "string";
  const requestedMode = String(req.body?.bookingMode ?? "").toLowerCase();
  const effectiveMode: FlexMode =
    requestedMode === "rolling" || requestedMode === "extra_night" || requestedMode === "none"
      ? (requestedMode as FlexMode)
      : hasBookingMode
      ? "none"
      : defaultFlexMode;

  const rollingMinCommitmentNights = Math.max(
    1,
    Math.round(Number((listingRow as any).flex_min_commitment_nights ?? 7)) || 7
  );
  const rollingMaxExtensionNights = Math.max(
    0,
    Math.round(Number((listingRow as any).flex_max_extension_nights ?? 7)) || 7
  );
  const flexExtensionNoticeHours = Math.max(
    1,
    Math.round(Number((listingRow as any).flex_extension_notice_hours ?? 24)) || 24
  );
  const flexExtensionPricingMode: "same_rate" | "premium_10" =
    String((listingRow as any).flex_extension_pricing_mode ?? "").toLowerCase() === "premium_10"
      ? "premium_10"
      : "same_rate";
  const rollingWindowDays = Math.max(
    1,
    Math.round(Number((listingRow as any).flex_rolling_window_days ?? 3)) || 3
  );
  const flexPricingMultiplierRaw = Number((listingRow as any).flex_pricing_multiplier ?? 1.1);
  const flexPricingMultiplier =
    Number.isFinite(flexPricingMultiplierRaw) && flexPricingMultiplierRaw > 0
      ? Math.min(5, Math.max(1, Number(flexPricingMultiplierRaw)))
      : 1.1;
  const flexAvailability = await evaluateFlexAvailability({
    supabase,
    listingId,
    checkIn,
    checkOut,
    config: {
      listingAllowsFlexibleStays: Boolean(listingAllowsFlexibleStays),
      flexMode: configuredFlexMode,
      rollingWindowDays,
      rollingMaxExtensionNights,
      supportsExtraNight,
      supportsRolling,
    },
  });

  if (!flexAvailability.baseAvailable) {
    return res.status(409).json({ error: "Selected dates are not available." });
  }

  const rollingFlexAllowed = flexAvailability.rollingFlexAvailable;
  const rollingWindowDaysAvailable =
    defaultFlexMode === "rolling" ? flexAvailability.rollingFlexWindowDaysAvailable : 0;
  const rollingMaxExtensionSupported =
    defaultFlexMode === "rolling"
      ? flexAvailability.rollingFlexMaxExtensionNightsSupported
      : 0;

  if (hasBookingMode && effectiveMode === "rolling" && !rollingFlexAllowed) {
    return res.status(409).json({
      error: "Rolling flex is not available for the selected dates.",
    });
  }

  const chargedNights = rangeNights;

  const hostNetNightlyPence = Math.round(Number(nightlyMajor) * 100);
  const pricing = computeRoundedGuestPricing({
    hostUnitPence: hostNetNightlyPence,
    units: chargedNights,
    nightsForFeeTier: chargedNights,
    isFirstCompletedBooking: false,
  });
  const hostNetTotalPence = pricing.host_total_pence;
  const guestUnitPricePence = pricing.rounded_guest_unit_pence;
  const pricingPolicy: FlexPricingPolicy = "incremental_only";
  const weeklyPrice = Number((listingRow as any).price_per_week);
  const monthlyPrice = Number((listingRow as any).price_per_month);
  const hasWeeklyDiscount =
    Number.isFinite(weeklyPrice) &&
    weeklyPrice > 0 &&
    weeklyPrice < Number(nightlyMajor) * 7;
  const hasMonthlyDiscount =
    Number.isFinite(monthlyPrice) &&
    monthlyPrice > 0 &&
    monthlyPrice < Number(nightlyMajor) * 30;
  const discountTierApplied: DiscountTierApplied =
    chargedNights >= 28 && hasMonthlyDiscount
      ? "monthly"
      : chargedNights >= 7 && hasWeeklyDiscount
      ? "weekly"
      : "none";

  const flexExtraNightAllowed = flexAvailability.extraNightAvailable;
  const flexExtraNightModifierPct = flexExtensionPricingMode === "premium_10" ? 10 : 0;
  const flexNightlyFromRoundedGuestPence =
    flexExtensionPricingMode === "premium_10"
      ? roundGuestPricePenceToNearestFivePounds(
          Math.round(pricing.rounded_guest_unit_pence * 1.1)
        )
      : pricing.rounded_guest_unit_pence;
  const flexExtraNightPricePence = flexExtraNightAllowed
    ? flexNightlyFromRoundedGuestPence
    : null;
  const rollingHostNetNightlyPence = Math.round(hostNetNightlyPence * flexPricingMultiplier);
  const rollingExtensionPricing = computeRoundedGuestPricing({
    hostUnitPence: rollingHostNetNightlyPence,
    units: 1,
    nightsForFeeTier: 1,
    isFirstCompletedBooking: false,
  });
  const rollingExtensionUnitPricePence =
    rollingFlexAllowed && effectiveMode === "rolling"
      ? rollingExtensionPricing.rounded_guest_unit_pence
      : null;
  const selectedFlexExtensionNights =
    effectiveMode === "rolling"
      ? Math.max(
          0,
          Math.round(Number(req.body?.flexMaxNights ?? chargedNights)) - chargedNights
        )
      : effectiveMode === "extra_night"
      ? 1
      : 0;

  if (ENABLE_API_DEBUG) {
    console.log(
      "PRICING_DEBUG_QUOTE\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            check_in: checkIn,
            check_out: checkOut,
            confirmed_nights: chargedNights,
            selected_flex_mode: effectiveMode,
            selected_flex_extension_nights: selectedFlexExtensionNights,
            nightly_displayed_price: guestUnitPricePence / 100,
            confirmed_stay_total: pricing.total_guest_pence / 100,
            pricing_policy: pricingPolicy,
            discount_tier_applied: discountTierApplied,
            extension_nightly_rate:
              rollingExtensionUnitPricePence != null
                ? rollingExtensionUnitPricePence / 100
                : flexExtraNightPricePence != null
                ? flexExtraNightPricePence / 100
                : null,
            amount_due_today: 0,
          },
          null,
          2
        )
    );
  }

  return res.status(200).json({
    nights: chargedNights,
    currency: "GBP",
    host_net_total_pence: hostNetTotalPence,
    guest_total_pence: pricing.total_guest_pence,
    guest_unit_price_pence: guestUnitPricePence,
    raw_guest_unit_price_pence: pricing.raw_guest_unit_pence,
    rounding_adjustment_pence: pricing.rounding_adjustment_pence,
    platform_fee_est_pence: pricing.platform_fee_pence,
    platform_fee_capped: pricing.platform_fee_capped,
    platform_fee_bps: pricing.platform_fee_bps,
    stripe_var_bps: pricing.stripe_var_bps,
    stripe_fixed_pence: pricing.stripe_fixed_pence,
    pricing_version: "all_in_v2_tiers_cap_firstfree",
    flex_extra_night_allowed: flexExtraNightAllowed,
    flex_extra_night_price_pence: flexExtraNightPricePence,
    flex_extra_night_modifier_pct: flexExtraNightModifierPct,
    flex_extension_notice_hours: flexExtensionNoticeHours,
    flex_extension_pricing_mode: flexExtensionPricingMode,
    flex_max_extension_nights: rollingMaxExtensionNights,
    flex_mode_default: defaultFlexMode,
    rolling_flex_allowed: rollingFlexAllowed,
    rolling_window_days: rollingWindowDays,
    rolling_min_commitment_nights: rollingMinCommitmentNights,
    rolling_max_extension_nights: rollingMaxExtensionSupported,
    flex_pricing_multiplier: flexPricingMultiplier,
    rolling_extension_unit_price_pence: rollingExtensionUnitPricePence,
    flex_pricing_policy: pricingPolicy,
    discount_tier_applied: discountTierApplied,
    amount_due_today_pence: 0,
    base_available: flexAvailability.baseAvailable,
    extra_night_available: flexAvailability.extraNightAvailable,
    rolling_flex_available: flexAvailability.rollingFlexAvailable,
    rolling_flex_window_days_available: rollingWindowDaysAvailable,
    rolling_flex_max_extension_nights_supported: rollingMaxExtensionSupported,
  });
}
