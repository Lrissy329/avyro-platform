import type { NextApiRequest, NextApiResponse } from "next";
import { differenceInCalendarDays } from "date-fns";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { evaluateFlexAvailability, type FlexMode } from "@/lib/flexAvailability";
import { calculateFlexCharge, type FlexPricingPolicy } from "@/lib/flexPricing";
import {
  computeRoundedGuestPricing,
  roundGuestPricePenceToNearestFivePounds,
} from "@/lib/pricing";
import { stripe } from "@/lib/stripe";
import type { BookingStayType } from "@/lib/calendarTypes";
import {
  addDaysUtc,
  computeRollingFlexCutoff,
  toUtcDateOnlyString,
} from "@/lib/flexStay";

const STAY_TYPES: BookingStayType[] = ["nightly", "day_use", "split_rest", "crashpad"];

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
    message.includes("flexible_stay_mode") ||
    message.includes("booking_flex_windows") ||
    message.includes("flex_mode") ||
    (message.includes("column") && message.includes("does not exist"))
  );
};

const isMissingBookingColumnError = (error: any) => {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const combined = `${message} ${details}`;
  return (
    code === "42703" ||
    code === "PGRST204" ||
    (combined.includes("column") &&
      (combined.includes("does not exist") || combined.includes("schema cache") || combined.includes("could not find")))
  );
};

const extractMissingBookingColumns = (error: any): string[] => {
  const texts = [
    String(error?.message ?? ""),
    String(error?.details ?? ""),
    String(error?.hint ?? ""),
  ];
  const columns = new Set<string>();
  const patterns = [
    /could not find the ['"`]([a-z0-9_]+)['"`] column of ['"`]bookings['"`] in the schema cache/gi,
    /column\s+bookings\.([a-z0-9_]+)\s+does not exist/gi,
    /column\s+["'`]?([a-z0-9_]+)["'`]?\s+does not exist/gi,
  ];

  for (const text of texts) {
    for (const pattern of patterns) {
      let match = pattern.exec(text);
      while (match) {
        if (match[1]) columns.add(String(match[1]).toLowerCase());
        match = pattern.exec(text);
      }
      pattern.lastIndex = 0;
    }
  }

  return Array.from(columns);
};

const CRITICAL_BOOKING_COLUMNS = new Set([
  "listing_id",
  "host_id",
  "guest_id",
  "status",
  "check_in_time",
  "check_out_time",
  "nights",
  "currency",
  "guest_total_pence",
  "guest_unit_price_pence",
  "host_net_total_pence",
]);

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
    bookingMode?: FlexMode;
    flexExtraNight?: boolean;
    flexMinNights?: number;
    flexMaxNights?: number;
    flexRollingWindowDays?: number;
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

  const listingSelects = [
    "id, user_id, title, rental_type, booking_unit, is_instant_book, is_crew_ready, price_per_night, price_per_hour, price_per_week, price_per_month, is_shared_stay, allow_flexible_stays, flexible_stay_mode, flex_min_commitment_nights, flex_max_extension_nights, flex_extension_notice_hours, flex_extension_pricing_mode, flex_rolling_window_days, flex_pricing_multiplier",
    "id, user_id, title, rental_type, booking_unit, is_instant_book, is_crew_ready, price_per_night, price_per_hour, price_per_week, price_per_month, is_shared_stay, allow_flexible_stays, flex_max_extension_nights, flex_extension_notice_hours, flex_extension_pricing_mode",
    "id, user_id, title, rental_type, booking_unit, is_instant_book, is_crew_ready, price_per_night, price_per_hour, price_per_week, price_per_month, is_shared_stay",
    "id, user_id, title, rental_type, booking_unit, is_instant_book, is_crew_ready, price_per_night, price_per_hour, price_per_week, price_per_month",
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
    console.error("[api/bookings/create] failed to fetch listing", listingError);
    return res.status(500).json({ error: "Unable to load listing." });
  }

  if (!listingRow?.user_id) {
    return res.status(404).json({ error: "Listing not found." });
  }
  if (Boolean((listingRow as any).is_shared_stay)) {
    return res.status(409).json({
      error: "This listing uses shared crew stay checkout.",
      code: "SHARED_STAY_USE_SHARED_CHECKOUT",
    });
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
    if (rangeNights >= 14) requiredLevel = 2;
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

  const hasBookingMode = typeof (req.body as any)?.bookingMode === "string";
  const requestedBookingModeRaw = String((req.body as any)?.bookingMode ?? "").toLowerCase();
  const requestedBookingMode: FlexMode =
    requestedBookingModeRaw === "rolling" ||
    requestedBookingModeRaw === "extra_night" ||
    requestedBookingModeRaw === "none"
      ? (requestedBookingModeRaw as FlexMode)
      : "none";
  const requestedFlexExtraNight = Boolean((req.body as any)?.flexExtraNight);

  const listingAllowsFlexibleStays = (listingRow as any).allow_flexible_stays ?? false;
  const configuredFlexModeRaw = String((listingRow as any).flexible_stay_mode ?? "").toLowerCase();
  const configuredFlexMode: FlexMode =
    !listingAllowsFlexibleStays
      ? "none"
      : configuredFlexModeRaw === "rolling"
      ? "rolling"
      : configuredFlexModeRaw === "extra_night"
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
  const effectiveBookingMode: FlexMode = hasBookingMode ? requestedBookingMode : defaultFlexMode;

  const listingMaxExtensionNights = Math.max(
    0,
    Math.round(Number((listingRow as any).flex_max_extension_nights ?? 7)) || 7
  );
  const listingFlexExtensionNoticeHours = Math.max(
    1,
    Math.round(Number((listingRow as any).flex_extension_notice_hours ?? 24)) || 24
  );
  const listingFlexExtensionPricingMode: "same_rate" | "premium_10" =
    String((listingRow as any).flex_extension_pricing_mode ?? "").toLowerCase() === "premium_10"
      ? "premium_10"
      : "same_rate";
  const listingRollingWindowDays = Math.max(
    1,
    Math.round(Number((listingRow as any).flex_rolling_window_days ?? 3)) || 3
  );
  const listingFlexPricingMultiplier = (() => {
    const parsed = Number((listingRow as any).flex_pricing_multiplier ?? 1.1);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1.1;
    return Math.min(5, Math.max(1, parsed));
  })();

  const flexAvailability = await evaluateFlexAvailability({
    supabase,
    listingId,
    checkIn,
    checkOut,
    config: {
      listingAllowsFlexibleStays: Boolean(listingAllowsFlexibleStays),
      flexMode: configuredFlexMode,
      rollingWindowDays: listingRollingWindowDays,
      rollingMaxExtensionNights: listingMaxExtensionNights,
      supportsExtraNight,
      supportsRolling,
    },
  });

  if (!flexAvailability.baseAvailable) {
    return res.status(409).json({
      error: "Selected dates are no longer available.",
      code: "BOOKING_DATES_UNAVAILABLE",
    });
  }

  const rollingFlexAllowed = flexAvailability.rollingFlexAvailable;

  const requestedFlexMaxNights = Math.round(
    Number((req.body as any)?.flexMaxNights ?? rangeNights + listingMaxExtensionNights)
  );
  const requestedRollingWindowDays = Math.round(
    Number((req.body as any)?.flexRollingWindowDays ?? listingRollingWindowDays)
  );

  const useRollingFlex = effectiveBookingMode === "rolling" && rollingFlexAllowed;

  if (effectiveBookingMode === "rolling" && !rollingFlexAllowed) {
    return res.status(409).json({
      error: "Rolling flex is not available for these dates.",
      code: "FLEX_ROLLING_WINDOW_UNAVAILABLE",
    });
  }

  const flexMinNights = useRollingFlex ? rangeNights : null;
  const maxExtensionAvailabilityCap = useRollingFlex
    ? Math.min(listingMaxExtensionNights, flexAvailability.rollingFlexMaxExtensionNightsSupported)
    : null;
  const maxNightsCap = useRollingFlex ? flexMinNights! + (maxExtensionAvailabilityCap ?? 0) : null;
  const flexMaxNights = useRollingFlex
    ? Math.max(flexMinNights!, Math.min(requestedFlexMaxNights, maxNightsCap!))
    : null;
  const flexRollingWindowDays = useRollingFlex
    ? Math.max(1, Math.min(requestedRollingWindowDays, listingRollingWindowDays))
    : null;

  if (
    useRollingFlex &&
    (!flexMinNights ||
      !flexMaxNights ||
      flexMaxNights <= flexMinNights ||
      (maxExtensionAvailabilityCap ?? 0) <= 0 ||
      flexAvailability.rollingFlexWindowDaysAvailable < (flexRollingWindowDays ?? 1))
  ) {
    return res.status(409).json({
      error: "Rolling flex window is not available for the selected dates.",
      code: "FLEX_ROLLING_WINDOW_UNAVAILABLE",
    });
  }
  if (
    useRollingFlex &&
    requestedFlexMaxNights > (maxNightsCap ?? 0)
  ) {
    return res.status(409).json({
      error: "Requested rolling extension exceeds currently available protected nights.",
      code: "FLEX_ROLLING_WINDOW_UNAVAILABLE",
    });
  }

  const flexExtraNightAllowed =
    supportsExtraNight &&
    !useRollingFlex &&
    flexAvailability.extraNightAvailable;
  const useFlexExtraNight = !useRollingFlex && requestedFlexExtraNight && flexExtraNightAllowed;
  if (requestedFlexExtraNight && !flexExtraNightAllowed) {
    return res.status(409).json({
      error: "Optional extra night is not available for the selected dates.",
      code: "FLEX_EXTRA_NIGHT_UNAVAILABLE",
    });
  }

  const hostNetNightlyPence = Math.round(Number(nightlyMajor) * 100);
  const chargedNights = rangeNights;
  const pricing = computeRoundedGuestPricing({
    hostUnitPence: hostNetNightlyPence,
    units: chargedNights,
    nightsForFeeTier: chargedNights,
    isFirstCompletedBooking: false,
  });
  const hostNetTotalPence = pricing.host_total_pence;
  const guestUnitPricePence = pricing.rounded_guest_unit_pence;
  const flexNightlyFromRoundedGuestPence =
    listingFlexExtensionPricingMode === "premium_10"
      ? roundGuestPricePenceToNearestFivePounds(
          Math.round(pricing.rounded_guest_unit_pence * 1.1)
        )
      : pricing.rounded_guest_unit_pence;
  const flexExtraNightPricePence = useFlexExtraNight
    ? flexNightlyFromRoundedGuestPence
    : null;
  const flexPricingPolicy: FlexPricingPolicy = "incremental_only";

  const weeklyDiscountPct = (() => {
    const weeklyPrice = Number((listingRow as any).price_per_week);
    const nightlyPrice = Number(nightlyMajor);
    if (!Number.isFinite(weeklyPrice) || weeklyPrice <= 0) return 0;
    if (!Number.isFinite(nightlyPrice) || nightlyPrice <= 0) return 0;
    const fullWeek = nightlyPrice * 7;
    if (weeklyPrice >= fullWeek) return 0;
    return Math.max(0, Math.min(100, ((fullWeek - weeklyPrice) / fullWeek) * 100));
  })();

  const monthlyDiscountPct = (() => {
    const monthlyPrice = Number((listingRow as any).price_per_month);
    const nightlyPrice = Number(nightlyMajor);
    if (!Number.isFinite(monthlyPrice) || monthlyPrice <= 0) return 0;
    if (!Number.isFinite(nightlyPrice) || nightlyPrice <= 0) return 0;
    const fullMonth = nightlyPrice * 30;
    if (monthlyPrice >= fullMonth) return 0;
    return Math.max(0, Math.min(100, ((fullMonth - monthlyPrice) / fullMonth) * 100));
  })();

  const initialPricingSnapshot = calculateFlexCharge({
    confirmedNights: chargedNights,
    extensionNights: 0,
    alreadyPaidPence: 0,
    nightlyRatePence: guestUnitPricePence,
    weeklyDiscountPct,
    monthlyDiscountPct,
    flexPricingPolicy,
    flexPricingMultiplier: useRollingFlex ? listingFlexPricingMultiplier : 1,
  });

  const checkInUtcDate = new Date(`${checkIn}T00:00:00Z`);
  const confirmedCheckoutUtcDate = new Date(`${checkOut}T00:00:00Z`);
  const checkInTimeIso = checkInUtcDate.toISOString();
  const checkOutTimeIso = confirmedCheckoutUtcDate.toISOString();
  const flexCutoffAtIso = useFlexExtraNight
    ? (() => {
        const cutoff = new Date(confirmedCheckoutUtcDate.getTime());
        cutoff.setUTCHours(0, 0, 0, 0);
        cutoff.setUTCHours(cutoff.getUTCHours() - listingFlexExtensionNoticeHours);
        return cutoff.toISOString();
      })()
    : null;
  const flexCurrentConfirmedEnd = useRollingFlex
    ? toUtcDateOnlyString(confirmedCheckoutUtcDate)
    : null;
  const flexMaxEndDate = useRollingFlex ? addDaysUtc(checkInUtcDate, Number(flexMaxNights)) : null;
  const flexMaxEnd = flexMaxEndDate ? toUtcDateOnlyString(flexMaxEndDate) : null;
  const flexExtensionCutoffAt = useRollingFlex
    ? computeRollingFlexCutoff({
        confirmedEndDate: flexCurrentConfirmedEnd!,
        daysBefore: 2,
        cutoffHour: 18,
        timezone: "Europe/London",
      })?.toISOString() ?? null
    : null;

  const payload: Record<string, any> = {
    listing_id: listingId,
    host_id: listingRow.user_id,
    guest_id: userData.user.id,
    status: "awaiting_payment",
    stay_type: stayType,
    channel: "direct",
    check_in_time: checkInTimeIso,
    check_out_time: checkOutTimeIso,
    nights: chargedNights,
    currency: "GBP",
    price_total: pricing.total_guest_pence / 100,
    host_net_total_pence: hostNetTotalPence,
    guest_total_pence: pricing.total_guest_pence,
    guest_unit_price_pence: guestUnitPricePence,
    platform_fee_bps: pricing.platform_fee_bps,
    stripe_var_bps: pricing.stripe_var_bps,
    stripe_fixed_pence: pricing.stripe_fixed_pence,
    pricing_version: "all_in_v2_tiers_cap_firstfree",
    flex_mode: useRollingFlex ? "rolling" : useFlexExtraNight ? "extra_night" : "none",
    flex_min_nights: useRollingFlex ? flexMinNights : null,
    flex_max_nights: useRollingFlex ? flexMaxNights : null,
    flex_current_confirmed_end: flexCurrentConfirmedEnd,
    flex_max_end: flexMaxEnd,
    flex_rolling_window_days: useRollingFlex ? flexRollingWindowDays : null,
    flex_status: useRollingFlex ? "active" : "inactive",
    flex_pricing_multiplier: useRollingFlex ? listingFlexPricingMultiplier : null,
    flex_pricing_policy: flexPricingPolicy,
    flex_last_extension_at: null,
    flex_extension_cutoff_at: flexExtensionCutoffAt,
    confirmed_total_pence: pricing.total_guest_pence,
    amount_paid_pence: 0,
    latest_repriced_total_pence: initialPricingSnapshot.totalConfirmedStayValuePence,
    discount_tier_applied: initialPricingSnapshot.discountTierApplied,
    flex_extra_night: useFlexExtraNight,
    flex_extra_night_price_pence: flexExtraNightPricePence,
    flex_extra_night_status: useFlexExtraNight ? "reserved" : "released",
    flex_extra_night_cutoff_at: flexCutoffAtIso,
  };

  if (typeof guests === "number") {
    payload.guests_total = guests;
  }

  let insertPayload: Record<string, any> = { ...payload };
  let { data: bookingRow, error: bookingError } = await supabase
    .from("bookings")
    .insert(insertPayload)
    .select()
    .single();

  let fallbackAttempt = 0;
  const maxFallbackAttempts = 20;
  while (
    bookingError &&
    (isMissingRelation(bookingError) || isMissingBookingColumnError(bookingError)) &&
    fallbackAttempt < maxFallbackAttempts
  ) {
    const missingColumns = extractMissingBookingColumns(bookingError).filter((column) =>
      Object.prototype.hasOwnProperty.call(insertPayload, column)
    );
    if (missingColumns.length === 0) {
      break;
    }

    const missingCriticalColumns = missingColumns.filter((column) =>
      CRITICAL_BOOKING_COLUMNS.has(column)
    );
    if (missingCriticalColumns.length > 0) {
      console.error("[api/bookings/create] missing critical booking columns", {
        missingCriticalColumns,
        errorCode: bookingError?.code ?? null,
        errorMessage: bookingError?.message ?? null,
        errorDetails: bookingError?.details ?? null,
      });
      return res.status(500).json({
        error:
          "Booking schema is missing required pricing columns. Run latest migrations and retry.",
      });
    }

    missingColumns.forEach((column) => {
      delete insertPayload[column];
    });

    fallbackAttempt += 1;
    const retry = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select()
      .single();
    bookingRow = retry.data;
    bookingError = retry.error;
  }

  if (bookingError || !bookingRow?.id) {
    console.error("[api/bookings/create] failed to create booking", bookingError);
    return res.status(400).json({ error: bookingError?.message ?? "Failed to create booking." });
  }

  if (useRollingFlex && flexCurrentConfirmedEnd && flexMaxEnd && flexRollingWindowDays) {
    const firstHoldStart = new Date(`${flexCurrentConfirmedEnd}T00:00:00Z`);
    const maxEndDate = new Date(`${flexMaxEnd}T00:00:00Z`);
    const firstHoldEndCandidate = addDaysUtc(firstHoldStart, flexRollingWindowDays);
    const firstHoldEnd =
      firstHoldEndCandidate.getTime() <= maxEndDate.getTime() ? firstHoldEndCandidate : maxEndDate;

    if (firstHoldEnd.getTime() > firstHoldStart.getTime()) {
      const cutoffAtIso =
        computeRollingFlexCutoff({
          confirmedEndDate: flexCurrentConfirmedEnd,
          daysBefore: 2,
          cutoffHour: 18,
          timezone: "Europe/London",
        })?.toISOString() ?? null;

      const flexWindowPayload = {
        booking_id: bookingRow.id,
        start_date: flexCurrentConfirmedEnd,
        end_date: toUtcDateOnlyString(firstHoldEnd),
        status: "held",
        cutoff_at: cutoffAtIso,
      };

      const flexWindowInsert = await supabase.from("booking_flex_windows").insert(flexWindowPayload);
      if (flexWindowInsert.error && !isMissingRelation(flexWindowInsert.error)) {
        console.warn(
          "[api/bookings/create] failed to create initial rolling flex window",
          flexWindowInsert.error.message
        );
      }
    }
  }

  const ensureBookingThread = async () => {
    try {
      const threadPayload = {
        booking_id: bookingRow.id,
        host_id: listingRow.user_id,
        guest_id: userData.user.id,
        last_message_at: null,
      };

      let threadId: string | null = null;

      const upsertResult = await supabase
        .from("conversations")
        .upsert(threadPayload, { onConflict: "booking_id" })
        .select("id")
        .single();

      if (upsertResult.error) {
        const msg = String(upsertResult.error.message ?? "").toLowerCase();
        if (msg.includes("no unique") || msg.includes("on conflict")) {
          const existing = await supabase
            .from("conversations")
            .select("id")
            .eq("booking_id", bookingRow.id)
            .maybeSingle();
          threadId = existing.data?.id ?? null;
          if (!threadId) {
            const insertResult = await supabase
              .from("conversations")
              .insert(threadPayload)
              .select("id")
              .single();
            threadId = insertResult.data?.id ?? null;
          }
        } else {
          console.warn("[api/bookings/create] failed to upsert thread", upsertResult.error);
        }
      } else {
        threadId = upsertResult.data?.id ?? null;
      }

      if (!threadId) return;

      const { data: existingMessages } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", threadId)
        .limit(1);

      if (existingMessages && existingMessages.length > 0) return;

      const guestName =
        userData.user.user_metadata?.full_name ??
        userData.user.user_metadata?.name ??
        userData.user.email ??
        "Guest";
      const listingTitle = listingRow.title ?? "Listing";
      const checkInLabel = checkIn;
      const checkOutLabel = checkOutTimeIso.slice(0, 10);
      const summaryBody = `Booking created for ${checkInLabel} → ${checkOutLabel} (${chargedNights} nights) at ${listingTitle}.\nGuest: ${guestName}.\nNext: Send check-in details and confirm ETA.`;
      const flexBody = useRollingFlex
        ? `\n\nYour stay includes flexible continuation.\nCurrent stay confirmed until ${flexCurrentConfirmedEnd}.\nYou can extend in stages up to ${flexMaxEnd}.\nWe’ll ask for confirmation before each cutoff.`
        : useFlexExtraNight
        ? `\n\nOptional extra night reserved: The next night after checkout is held until confirmation. No charge has been applied for the optional night yet.`
        : "";

      const systemPayload = {
        conversation_id: threadId,
        sender_id: null,
        sender_role: "system",
        body: `${summaryBody}${flexBody}`,
      };

      const insertResult = await supabase
        .from("messages")
        .insert(systemPayload)
        .select("id, created_at")
        .single();

      if (insertResult.error) {
        const fallback = await supabase
          .from("messages")
          .insert({
            conversation_id: threadId,
            sender_id: listingRow.user_id,
            body: `${summaryBody}${flexBody}`,
          })
          .select("id, created_at")
          .single();

        if (fallback.data?.created_at) {
          await supabase
            .from("conversations")
            .update({ last_message_at: fallback.data.created_at })
            .eq("id", threadId);
        }
      } else if (insertResult.data?.created_at) {
        await supabase
          .from("conversations")
          .update({ last_message_at: insertResult.data.created_at })
          .eq("id", threadId);
      }
    } catch (err) {
      console.warn("[api/bookings/create] thread creation failed", err);
    }
  };

  await ensureBookingThread();

  const guestTotalPence = Number(bookingRow.guest_total_pence);
  if (!Number.isInteger(guestTotalPence)) {
    console.error("[api/bookings/create] guest_total_pence is not integer", {
      raw: bookingRow.guest_total_pence,
      parsed: guestTotalPence,
      bookingId: bookingRow.id ?? null,
    });
    return res.status(500).json({ error: "guest_total_pence must be integer pence." });
  }
  if (guestTotalPence <= 0) {
    console.error("[api/bookings/create] guest_total_pence is not positive", {
      parsed: guestTotalPence,
      bookingId: bookingRow.id ?? null,
    });
    return res.status(500).json({ error: "guest_total_pence must be positive pence." });
  }

  const origin = resolveOrigin();
  const successUrl = `${origin}/booking/success?booking=${bookingRow.id}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/listing/${listingId}?payment=cancelled`;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: String(bookingRow.currency ?? "GBP").toLowerCase(),
      customer_creation: "always",
      payment_method_types: ["card"],
      payment_intent_data: {
        setup_future_usage: "off_session",
      },
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
        flex_mode: useRollingFlex ? "rolling" : useFlexExtraNight ? "extra_night" : "none",
        flex_min_nights: useRollingFlex ? String(flexMinNights) : "",
        flex_max_nights: useRollingFlex ? String(flexMaxNights) : "",
      },
    });
  } catch (stripeError: any) {
    console.error("[api/bookings/create] stripe checkout session failed", {
      message: stripeError?.message ?? "unknown stripe error",
      type: stripeError?.type ?? null,
      code: stripeError?.code ?? null,
      bookingId: bookingRow.id ?? null,
      listingId,
      guestTotalPence,
      quoteGuestTotalPence: pricing.total_guest_pence,
      guestUnitPricePence,
    });
    return res.status(500).json({ error: "Unable to start Stripe checkout." });
  }

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
