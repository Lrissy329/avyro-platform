import { addDaysUtc, toUtcDateOnly, toUtcDateOnlyString } from "@/lib/flexStay";

type SupabaseLike = any;

export type FlexMode = "none" | "extra_night" | "rolling";

export type FlexAvailabilityConfig = {
  listingAllowsFlexibleStays: boolean;
  flexMode: FlexMode;
  rollingWindowDays: number;
  rollingMaxExtensionNights: number;
  supportsExtraNight?: boolean;
  supportsRolling?: boolean;
};

export type FlexAvailabilityResult = {
  baseAvailable: boolean;
  extraNightAvailable: boolean;
  rollingFlexAvailable: boolean;
  rollingFlexWindowDaysAvailable: number;
  rollingFlexMaxExtensionNightsSupported: number;
};

export const ACTIVE_NIGHTLY_BOOKING_STATUSES = [
  "pending",
  "awaiting_payment",
  "approved",
  "confirmed",
  "paid",
] as const;

const parseDateOnly = (value: string | Date): Date | null => {
  if (value instanceof Date) {
    const iso = value.toISOString().slice(0, 10);
    return toUtcDateOnly(iso);
  }
  return toUtcDateOnly(String(value));
};

const maxInt = (value: number, fallback: number, min = 0) => {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.max(min, fallback);
  return Math.max(min, parsed);
};

const isMissingRelation = (error: any) => {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42p01" ||
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("relation") ||
    message.includes("schema cache") ||
    (message.includes("column") && message.includes("does not exist"))
  );
};

const markNights = (
  startDate: Date,
  endDateExclusive: Date,
  target: Set<string>,
  windowStart: Date,
  windowEndExclusive: Date
) => {
  const start =
    startDate.getTime() > windowStart.getTime() ? startDate : windowStart;
  const end =
    endDateExclusive.getTime() < windowEndExclusive.getTime()
      ? endDateExclusive
      : windowEndExclusive;
  if (end.getTime() <= start.getTime()) return;

  for (let cursor = new Date(start); cursor < end; cursor = addDaysUtc(cursor, 1)) {
    target.add(toUtcDateOnlyString(cursor));
  }
};

const toDayBounds = (isoDate: string) => ({
  start: `${isoDate}T00:00:00.000Z`,
  end: `${isoDate}T23:59:59.999Z`,
});

export async function loadUnavailableNightSets(params: {
  supabase: SupabaseLike;
  listingId: string;
  windowStartDate: Date;
  windowEndDateExclusive: Date;
  excludeBookingId?: string | null;
  excludeFlexWindowId?: string | null;
  ignoreSharedGroupBookings?: boolean;
}) {
  const {
    supabase,
    listingId,
    windowStartDate,
    windowEndDateExclusive,
    excludeBookingId,
    excludeFlexWindowId,
    ignoreSharedGroupBookings = false,
  } = params;

  const windowStartIsoDate = toUtcDateOnlyString(windowStartDate);
  const windowEndIsoDate = toUtcDateOnlyString(windowEndDateExclusive);

  const windowStartIso = toDayBounds(windowStartIsoDate).start;
  const windowEndIso = toDayBounds(windowEndIsoDate).start;

  const booked = new Set<string>();
  const blocked = new Set<string>();
  const held = new Set<string>();

  const bookingSelects = [
    "id, booking_type, check_in_time, check_out_time, stay_type, status, flex_mode, flex_extra_night, flex_extra_night_status",
    "id, booking_type, check_in_time, check_out_time, stay_type, status, flex_mode",
    "id, booking_type, check_in_time, check_out_time, stay_type, status, flex_extra_night, flex_extra_night_status",
    "id, booking_type, check_in_time, check_out_time, stay_type, status",
    "id, check_in_time, check_out_time, stay_type, status, flex_mode",
    "id, check_in_time, check_out_time, stay_type, status, flex_extra_night, flex_extra_night_status",
    "id, check_in_time, check_out_time, stay_type, status",
  ];

  let bookingRows: any[] = [];
  let bookingError: any = null;

  for (const select of bookingSelects) {
    let query = supabase
      .from("bookings")
      .select(select)
      .eq("listing_id", listingId)
      .lt("check_in_time", windowEndIso)
      .gt("check_out_time", windowStartIso)
      .in("stay_type", ["nightly", "crashpad"])
      .in("status", [...ACTIVE_NIGHTLY_BOOKING_STATUSES]);

    if (excludeBookingId) {
      query = query.neq("id", excludeBookingId);
    }

    const result = await query;
    bookingRows = result.data ?? [];
    bookingError = result.error;
    if (!bookingError) break;
    if (!isMissingRelation(bookingError)) break;
  }

  if (bookingError) {
    throw bookingError;
  }

  const rollingBookingIds: string[] = [];

  for (const row of bookingRows) {
    if (ignoreSharedGroupBookings && String(row?.booking_type ?? "").toLowerCase() === "shared_group") {
      continue;
    }

    const checkIn = new Date(String(row?.check_in_time ?? ""));
    const checkOut = new Date(String(row?.check_out_time ?? ""));
    if (!Number.isFinite(checkIn.getTime()) || !Number.isFinite(checkOut.getTime())) continue;

    const checkInDay = toUtcDateOnly(toUtcDateOnlyString(checkIn));
    const checkOutDay = toUtcDateOnly(toUtcDateOnlyString(checkOut));
    if (!checkInDay || !checkOutDay) continue;

    markNights(checkInDay, checkOutDay, booked, windowStartDate, windowEndDateExclusive);

    if (String(row?.flex_mode ?? "").toLowerCase() === "rolling" && row?.id) {
      rollingBookingIds.push(String(row.id));
    }

    const hasReservedExtraNight =
      Boolean(row?.flex_extra_night) &&
      String(row?.flex_extra_night_status ?? "").toLowerCase() === "reserved";
    if (hasReservedExtraNight) {
      const optionalNightDate = toUtcDateOnly(toUtcDateOnlyString(checkOut));
      if (optionalNightDate) {
        const optionalNight = toUtcDateOnlyString(optionalNightDate);
        if (
          optionalNightDate.getTime() >= windowStartDate.getTime() &&
          optionalNightDate.getTime() < windowEndDateExclusive.getTime() &&
          !booked.has(optionalNight)
        ) {
          held.add(optionalNight);
          blocked.add(optionalNight);
        }
      }
    }
  }

  if (rollingBookingIds.length > 0) {
    const { data: windows, error: windowsError } = await supabase
      .from("booking_flex_windows")
      .select("id, booking_id, start_date, end_date, status")
      .in("booking_id", rollingBookingIds)
      .in("status", ["held", "confirmed"])
      .lt("start_date", windowEndIsoDate)
      .gt("end_date", windowStartIsoDate);

    if (windowsError && !isMissingRelation(windowsError)) {
      throw windowsError;
    }

    for (const window of windows ?? []) {
      if (excludeFlexWindowId && String(window.id) === excludeFlexWindowId) continue;
      const start = toUtcDateOnly(String(window.start_date));
      const end = toUtcDateOnly(String(window.end_date));
      if (!start || !end) continue;

      const isConfirmed = String(window.status ?? "").toLowerCase() === "confirmed";
      const target = isConfirmed ? booked : blocked;

      const temp = new Set<string>();
      markNights(start, end, temp, windowStartDate, windowEndDateExclusive);
      temp.forEach((night) => {
        if (!isConfirmed && booked.has(night)) return;
        if (!isConfirmed) {
          held.add(night);
        }
        target.add(night);
      });
    }
  }

  const { data: blocks, error: blocksError } = await supabase
    .from("listing_calendar_blocks")
    .select("start_date, end_date")
    .eq("listing_id", listingId)
    .not("start_date", "is", null)
    .not("end_date", "is", null)
    .lt("start_date", windowEndIsoDate)
    .gt("end_date", windowStartIsoDate);

  if (blocksError && !isMissingRelation(blocksError)) {
    throw blocksError;
  }

  for (const block of blocks ?? []) {
    const start = toUtcDateOnly(String(block.start_date));
    const end = toUtcDateOnly(String(block.end_date));
    if (!start || !end) continue;

    const temp = new Set<string>();
    markNights(start, end, temp, windowStartDate, windowEndDateExclusive);
    temp.forEach((night) => {
      if (!booked.has(night)) blocked.add(night);
    });
  }

  const unavailable = new Set<string>();
  booked.forEach((night) => unavailable.add(night));
  blocked.forEach((night) => unavailable.add(night));
  held.forEach((night) => unavailable.add(night));

  return {
    booked,
    blocked,
    held,
    unavailable,
  };
}

export async function evaluateFlexAvailability(params: {
  supabase: SupabaseLike;
  listingId: string;
  checkIn: string | Date;
  checkOut: string | Date;
  config: FlexAvailabilityConfig;
  excludeBookingId?: string | null;
  excludeFlexWindowId?: string | null;
}) {
  const {
    supabase,
    listingId,
    checkIn,
    checkOut,
    config,
    excludeBookingId,
    excludeFlexWindowId,
  } = params;

  const checkInDate = parseDateOnly(checkIn);
  const checkOutDate = parseDateOnly(checkOut);
  if (!checkInDate || !checkOutDate || checkOutDate.getTime() <= checkInDate.getTime()) {
    throw new Error("Invalid checkIn/checkOut range.");
  }

  const rollingWindowDays = maxInt(config.rollingWindowDays, 1, 1);
  const rollingMaxExtensionNights = maxInt(config.rollingMaxExtensionNights, 0, 0);
  const probeNights = Math.max(1, rollingWindowDays, rollingMaxExtensionNights);
  const windowEnd = addDaysUtc(checkOutDate, probeNights);

  const { unavailable } = await loadUnavailableNightSets({
    supabase,
    listingId,
    windowStartDate: checkInDate,
    windowEndDateExclusive: windowEnd,
    excludeBookingId,
    excludeFlexWindowId,
  });

  let baseAvailable = true;
  for (let cursor = new Date(checkInDate); cursor < checkOutDate; cursor = addDaysUtc(cursor, 1)) {
    if (unavailable.has(toUtcDateOnlyString(cursor))) {
      baseAvailable = false;
      break;
    }
  }

  const checkoutKey = toUtcDateOnlyString(checkOutDate);
  const nextNightFree = !unavailable.has(checkoutKey);

  let consecutiveExtensionNights = 0;
  for (let i = 0; i < probeNights; i += 1) {
    const extensionDate = addDaysUtc(checkOutDate, i);
    const key = toUtcDateOnlyString(extensionDate);
    if (unavailable.has(key)) break;
    consecutiveExtensionNights += 1;
  }

  const supportsExtraNight =
    config.listingAllowsFlexibleStays &&
    (typeof config.supportsExtraNight === "boolean"
      ? config.supportsExtraNight
      : config.flexMode === "extra_night");
  const supportsRolling =
    config.listingAllowsFlexibleStays &&
    (typeof config.supportsRolling === "boolean"
      ? config.supportsRolling
      : config.flexMode === "rolling");
  const rollingModeEnabled = supportsRolling;
  const rollingFlexWindowDaysAvailable = rollingModeEnabled
    ? Math.min(rollingWindowDays, consecutiveExtensionNights)
    : 0;
  const rollingFlexMaxExtensionNightsSupported = rollingModeEnabled
    ? Math.min(rollingMaxExtensionNights, consecutiveExtensionNights)
    : 0;

  const extraNightAvailable =
    baseAvailable &&
    supportsExtraNight &&
    nextNightFree;
  const rollingFlexAvailable =
    baseAvailable &&
    rollingModeEnabled &&
    rollingWindowDays > 0 &&
    rollingFlexWindowDaysAvailable >= rollingWindowDays;

  const result: FlexAvailabilityResult = {
    baseAvailable,
    extraNightAvailable,
    rollingFlexAvailable,
    rollingFlexWindowDaysAvailable,
    rollingFlexMaxExtensionNightsSupported,
  };

  return {
    ...result,
    unavailable,
  };
}

export async function ensureRangeAvailable(params: {
  supabase: SupabaseLike;
  listingId: string;
  startDate: string | Date;
  endDate: string | Date;
  excludeBookingId?: string | null;
  excludeFlexWindowId?: string | null;
}) {
  const { supabase, listingId, startDate, endDate, excludeBookingId, excludeFlexWindowId } = params;
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || end.getTime() <= start.getTime()) {
    return false;
  }

  const { unavailable } = await loadUnavailableNightSets({
    supabase,
    listingId,
    windowStartDate: start,
    windowEndDateExclusive: end,
    excludeBookingId,
    excludeFlexWindowId,
  });

  for (let cursor = new Date(start); cursor < end; cursor = addDaysUtc(cursor, 1)) {
    if (unavailable.has(toUtcDateOnlyString(cursor))) {
      return false;
    }
  }
  return true;
}
