// components/BookingWidget.tsx
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import {
  computeAllInPricing,
  computeRoundedGuestPricing,
  computeSharedPerPersonWeeklyPricePence,
  roundGuestPricePenceToNearestFivePounds,
} from "@/lib/pricing";
import { addDays, startOfDay } from "@/lib/dateUtils";
import DatePicker from "react-datepicker";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import BookingModeSelector from "@/components/booking/BookingModeSelector";
import ExtraNightFlexPanel from "@/components/booking/ExtraNightFlexPanel";
import { SharedStaySection } from "@/components/shared-stay/SharedStaySection";
import { JoinSharedStayModal } from "@/components/shared-stay/JoinSharedStayModal";
import { StartSharedGroupModal } from "@/components/shared-stay/StartSharedGroupModal";
import type { SharedGroupOption } from "@/components/shared-stay/types";
import { useSharedStayCheckout } from "@/hooks/useSharedStayCheckout";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, Clock3, Moon, Repeat2 } from "lucide-react";
import type { BookingStayType } from "@/lib/calendarTypes";

type BookingWidgetProps = {
  listingId: string;
  listingTitle?: string | null;
  basePrice: number | null;
  hostId: string;
  isSharedStay?: boolean | null;
  sharedTotalSpots?: number | null;
  sharedWeeklyPricePence?: number | null;
  sharedJoinMode?: "open" | "approval" | string | null;
  sharedMinWeeks?: number | null;
  sharedMaxWeeks?: number | null;
  allowFlexibleStays?: boolean | null;
  flexibleStayMode?: "none" | "extra_night" | "rolling" | null;
  flexMinCommitmentNights?: number | null;
  flexMaxExtensionNights?: number | null;
  flexExtensionNoticeHours?: number | null;
  flexExtensionPricingMode?: "same_rate" | "premium_10" | null;
  flexRollingWindowDays?: number | null;
  flexPricingMultiplier?: number | null;
  bookingUnit?: "nightly" | "hourly" | null;
  rentalType?: string | null;
  nightlyRange?: {
    from: Date | null;
    to: Date | null;
  };
  onNightlyRangeChange?: (range: { from: Date | null; to: Date | null }) => void;
};

type GuestCounts = {
  adults: number;
  children: number;
  infants: number;
  pets: number;
};

type BookingQuote = {
  nights: number;
  currency: "GBP";
  host_net_total_pence: number;
  guest_total_pence: number;
  guest_unit_price_pence: number;
  raw_guest_unit_price_pence?: number;
  rounding_adjustment_pence?: number;
  platform_fee_est_pence: number;
  platform_fee_capped: boolean;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: "all_in_v2_tiers_cap_firstfree";
  flex_extra_night_allowed?: boolean;
  flex_extra_night_price_pence?: number | null;
  flex_extra_night_modifier_pct?: number;
  flex_mode_default?: "none" | "extra_night" | "rolling";
  rolling_flex_allowed?: boolean;
  rolling_window_days?: number;
  rolling_min_commitment_nights?: number;
  rolling_max_extension_nights?: number;
  flex_pricing_multiplier?: number;
  rolling_extension_unit_price_pence?: number | null;
  flex_extension_notice_hours?: number;
  flex_extension_pricing_mode?: "same_rate" | "premium_10";
  flex_max_extension_nights?: number;
  flex_pricing_policy?: "incremental_only" | "reprice_on_threshold";
  discount_tier_applied?: "none" | "weekly" | "monthly";
  amount_due_today_pence?: number;
  base_available?: boolean;
  extra_night_available?: boolean;
  rolling_flex_available?: boolean;
  rolling_flex_window_days_available?: number;
  rolling_flex_max_extension_nights_supported?: number;
};

type FlexMode = "none" | "extra_night" | "rolling";
type BookingTypeChoice = "fixed" | "flexible";
type PlannedBookingType = BookingTypeChoice | "assignment";
type FlexTypeChoice = "extra_night" | "rolling";
type SharedCheckoutAction = "join" | "start";
type BookingWidgetCtaState = {
  label: string;
  disabled: boolean;
  reason: string | null;
  helper: string | null;
};

const ROLLING_EXTRA_OPTIONS = [1, 3, 7, 14];
const DEBUG_FORCE_FLEX_MODE: FlexMode | null = null;
const ENABLE_WIDGET_DEBUG =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEBUG_BOOKING_WIDGET === "1";
const debugLog = (message: string) => {
  if (!ENABLE_WIDGET_DEBUG) return;
  console.log(message);
};
const debugWarn = (message: string) => {
  if (!ENABLE_WIDGET_DEBUG) return;
  console.warn(message);
};

const formatCurrency = (value: number, currency = "GBP") => {
  const isWhole = Math.round(value * 100) % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  }).format(value);
};
const formatUnits = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const toISODate = (date: Date) => toDateInputValue(date);
const addDaysToDateInput = (dateStr: string, days: number) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const next = new Date(year, (month ?? 1) - 1, (day ?? 1) + days);
  return toDateInputValue(next);
};
const addDaysToIsoKey = (dateStr: string, days: number) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return null;
  const next = new Date(year, month - 1, day + days);
  if (!Number.isFinite(next.getTime())) return null;
  return toDateInputValue(next);
};
const parseDateInputValue = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};
const normalizeDateParam = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const datePrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  if (datePrefix && parseDateInputValue(datePrefix)) return datePrefix;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return "";
  return toDateInputValue(parsed);
};
const normalizeTimeParam = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)/);
  if (!match) return "";
  return `${match[1]}:${match[2]}`;
};
const parseISODate = (value: string) => new Date(`${value}T00:00:00`);
const minDateValue = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INVALID_LISTING_IDS = new Set(["", "undefined", "null"]);
const normalizeDayKeys = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry === "string" && DAY_KEY_PATTERN.test(entry)) {
      deduped.add(entry);
    }
  });
  return Array.from(deduped).sort();
};

const isFullWeekDateRange = (checkIn: string, checkOut: string) => {
  if (!checkIn || !checkOut || checkOut <= checkIn) return false;
  const start = parseDateInputValue(checkIn);
  const end = parseDateInputValue(checkOut);
  if (!start || !end || end <= start) return false;
  const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays > 0 && diffDays % 7 === 0;
};

const STAY_TYPE_CONFIG: Record<
  BookingStayType,
  { label: string; description: string; unitLabel: "night" | "hour"; isHourly: boolean }
> = {
  nightly: {
    label: "Nightly",
    description: "Standard overnight stay",
    unitLabel: "night",
    isHourly: false,
  },
  crashpad: {
    label: "Extended stay",
    description: "Longer-term stay booked nightly",
    unitLabel: "night",
    isHourly: false,
  },
  day_use: {
    label: "Day use (6 hours)",
    description: "Short rest during the day",
    unitLabel: "hour",
    isHourly: true,
  },
  split_rest: {
    label: "Rest window",
    description: "Hourly rest between shifts",
    unitLabel: "hour",
    isHourly: true,
  },
};

const resolveStayType = (rentalType?: string | null, bookingUnit?: string | null): BookingStayType => {
  if (rentalType === "day_use") return "day_use";
  if (rentalType === "split_rest") return "split_rest";
  if (rentalType === "crashpad") return "crashpad";
  if (bookingUnit === "hourly") return "day_use";
  return "nightly";
};

export default function BookingWidget({
  listingId,
  listingTitle,
  basePrice,
  hostId,
  isSharedStay,
  sharedTotalSpots,
  sharedWeeklyPricePence,
  sharedJoinMode,
  sharedMinWeeks,
  sharedMaxWeeks,
  allowFlexibleStays,
  flexibleStayMode,
  flexMinCommitmentNights,
  flexMaxExtensionNights,
  flexExtensionNoticeHours,
  flexExtensionPricingMode,
  flexRollingWindowDays,
  flexPricingMultiplier,
  bookingUnit,
  rentalType,
  nightlyRange,
  onNightlyRangeChange,
}: BookingWidgetProps) {
  const router = useRouter();
  const queryDebugFlexMode =
    typeof router.query.debugFlexMode === "string" ? router.query.debugFlexMode : "";
  const debugForceFlexModeFromQuery: FlexMode | null =
    queryDebugFlexMode === "rolling" ||
    queryDebugFlexMode === "extra_night" ||
    queryDebugFlexMode === "none"
      ? queryDebugFlexMode
      : null;
  const effectiveDebugFlexMode = debugForceFlexModeFromQuery ?? DEBUG_FORCE_FLEX_MODE;
  const [stayType, setStayType] = useState<BookingStayType>("nightly");
  const [checkInDate, setCheckInDate] = useState<string>("");
  const [checkInTimeLocal, setCheckInTimeLocal] = useState<string>("14:00");
  const [checkOutDate, setCheckOutDate] = useState<string>("");
  const [checkOutTimeLocal, setCheckOutTimeLocal] = useState<string>("10:00");
  const [guests, setGuests] = useState<GuestCounts>({
    adults: 1,
    children: 0,
    infants: 0,
    pets: 0,
  });
  const [showGuests, setShowGuests] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(null);
  const [calendarMonths, setCalendarMonths] = useState(2);
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const calendarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [availabilityStart, setAvailabilityStart] = useState(() => startOfDay(new Date()));
  const [availabilityEnd, setAvailabilityEnd] = useState(() => addDays(startOfDay(new Date()), 90));
  const [bookedSet, setBookedSet] = useState<Set<string>>(new Set());
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [heldSet, setHeldSet] = useState<Set<string>>(new Set());
  const [sharedOccupiedSet, setSharedOccupiedSet] = useState<Set<string>>(new Set());
  const [pendingQuickJoinGroupId, setPendingQuickJoinGroupId] = useState<string | null>(null);
  const [showSharedCreationFlow, setShowSharedCreationFlow] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const latestAvailabilityRequestIdRef = useRef(0);
  const hasAppliedAvailabilityRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [verificationRequired, setVerificationRequired] = useState<number | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [bookingType, setBookingType] = useState<PlannedBookingType>("fixed");
  const [flexType, setFlexType] = useState<FlexTypeChoice>("extra_night");
  const [rollingExtraNights, setRollingExtraNights] = useState(
    Math.max(1, Math.round(Math.min(7, Number(flexMaxExtensionNights ?? 7))) || 7)
  );
  const [showJoinSharedModal, setShowJoinSharedModal] = useState(false);
  const [showStartSharedModal, setShowStartSharedModal] = useState(false);
  const [selectedSharedGroupId, setSelectedSharedGroupId] = useState<string | null>(null);
  const [startGroupWeeks, setStartGroupWeeks] = useState(1);
  const [sharedCheckoutLoadingAction, setSharedCheckoutLoadingAction] =
    useState<SharedCheckoutAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const resolvedStayType = useMemo(
    () => resolveStayType(rentalType, bookingUnit),
    [rentalType, bookingUnit]
  );
  const stayTypeConfig = useMemo(
    () => STAY_TYPE_CONFIG[resolvedStayType],
    [resolvedStayType]
  );
  const isHourlyStay = stayTypeConfig.isHourly;
  const isSharedStayListing = Boolean(isSharedStay);
  const sharedJoinModeNormalized =
    String(sharedJoinMode ?? "").toLowerCase() === "approval" ? "approval" : "open";
  const sharedTotalSpotsNormalized = Math.max(
    1,
    Math.round(Number(sharedTotalSpots ?? 1)) || 1
  );
  const sharedPerPersonWeeklyPricePenceFromListing =
    sharedWeeklyPricePence != null && Number.isFinite(Number(sharedWeeklyPricePence))
      ? computeSharedPerPersonWeeklyPricePence({
          totalWeeklyPricePence: Number(sharedWeeklyPricePence),
          totalSpots: sharedTotalSpotsNormalized,
        }).rounded_per_person_weekly_pence
      : null;
  const listingAllowsFlexibleStays = !isSharedStayListing && (allowFlexibleStays ?? false);
  const listingFlexMode = useMemo<FlexMode>(() => {
    if (!listingAllowsFlexibleStays) return "none";
    const resolvedMode = effectiveDebugFlexMode ?? flexibleStayMode;
    if (resolvedMode === "rolling") return "rolling";
    if (resolvedMode === "extra_night") return "extra_night";
    return "none";
  }, [effectiveDebugFlexMode, listingAllowsFlexibleStays, flexibleStayMode]);
  const selectedBookingType: BookingTypeChoice =
    bookingType === "flexible" ? "flexible" : "fixed";
  const staySummary = useMemo(() => {
    if (resolvedStayType === "day_use" || resolvedStayType === "split_rest") {
      return {
        label: "Hourly stay",
        details: `${stayTypeConfig.description} · Locked by host`,
      };
    }
    if (resolvedStayType === "crashpad") {
      return {
        label: "Long stay",
        details: `${stayTypeConfig.description} · Locked by host`,
      };
    }
    return {
      label: "Nightly stay",
      details: `${stayTypeConfig.description} · Locked by host`,
    };
  }, [resolvedStayType, stayTypeConfig.description]);
  const selectedBookingModeForQuote: FlexMode =
    selectedBookingType === "flexible"
      ? "extra_night"
      : "none";
  const didHydrateFromQueryRef = useRef(false);
  const lastSharedParentRangeSkipRef = useRef<string | null>(null);
  const hasValidListingId = useMemo(
    () => typeof listingId === "string" && !INVALID_LISTING_IDS.has(listingId.trim()),
    [listingId]
  );

  const toUtcIso = (dateStr: string, timeStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const [hours, minutes] = timeStr.split(":").map(Number);
    const local = new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0);
    return local.toISOString();
  };

  useEffect(() => {
    if (!router.isReady || didHydrateFromQueryRef.current) return;
    const nextCheckIn = normalizeDateParam(router.query.checkIn);
    const nextCheckOut = normalizeDateParam(router.query.checkOut);
    const nextCheckInTime = normalizeTimeParam(router.query.checkInTime);
    const nextCheckOutTime = normalizeTimeParam(router.query.checkOutTime);

    if (!nextCheckIn && !nextCheckOut && !nextCheckInTime && !nextCheckOutTime) {
      didHydrateFromQueryRef.current = true;
      return;
    }

    if (nextCheckIn) setCheckInDate(nextCheckIn);
    if (nextCheckOut) setCheckOutDate(nextCheckOut);
    if (nextCheckInTime) setCheckInTimeLocal(nextCheckInTime);
    if (nextCheckOutTime) setCheckOutTimeLocal(nextCheckOutTime);

    if (!isHourlyStay && onNightlyRangeChange && nextCheckIn && nextCheckOut) {
      const from = parseDateInputValue(nextCheckIn);
      const to = parseDateInputValue(nextCheckOut);
      if (from && to && to > from) {
        onNightlyRangeChange({ from, to });
      }
    }

    didHydrateFromQueryRef.current = true;
  }, [
    router.isReady,
    router.query.checkIn,
    router.query.checkOut,
    router.query.checkInTime,
    router.query.checkOutTime,
    isHourlyStay,
    onNightlyRangeChange,
  ]);

  useEffect(() => {
    setBookingType("fixed");
    setFlexType("extra_night");
    setShowJoinSharedModal(false);
    setShowStartSharedModal(false);
    setSelectedSharedGroupId(null);
    setSharedCheckoutLoadingAction(null);
    setBookedSet(new Set());
    setBlockedSet(new Set());
    setHeldSet(new Set());
    setAvailabilityLoading(false);
    latestAvailabilityRequestIdRef.current = 0;
    hasAppliedAvailabilityRef.current = false;
  }, [listingId]);

  useEffect(() => {
    // Temporary debug log for live listing-to-widget flex wiring.
    debugLog(
      "BOOKING_WIDGET_LISTING\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            listing_title: listingTitle ?? null,
            route_listing_id:
              typeof router.query.id === "string" ? router.query.id : null,
            route_path: router.asPath,
            is_shared_stay: isSharedStayListing,
            shared_total_spots: sharedTotalSpots ?? null,
            shared_weekly_price_pence: sharedWeeklyPricePence ?? null,
            shared_join_mode: sharedJoinModeNormalized,
            shared_min_weeks: sharedMinWeeks ?? null,
            shared_max_weeks: sharedMaxWeeks ?? null,
            allow_flexible_stays: listingAllowsFlexibleStays,
            flexible_stay_mode: listingFlexMode,
            flex_min_commitment_nights: flexMinCommitmentNights,
            flex_max_extension_nights: flexMaxExtensionNights,
            flex_extension_notice_hours: flexExtensionNoticeHours,
            flex_extension_pricing_mode: flexExtensionPricingMode,
            flex_rolling_window_days: flexRollingWindowDays,
            flex_pricing_multiplier: flexPricingMultiplier,
            debug_force_flex_mode: DEBUG_FORCE_FLEX_MODE,
            debug_force_flex_mode_from_query: debugForceFlexModeFromQuery,
          },
          null,
          2
        )
    );
  }, [
    debugForceFlexModeFromQuery,
    flexMaxExtensionNights,
    flexExtensionNoticeHours,
    flexExtensionPricingMode,
    flexMinCommitmentNights,
    flexPricingMultiplier,
    flexRollingWindowDays,
    listingId,
    isSharedStayListing,
    listingAllowsFlexibleStays,
    listingFlexMode,
    listingTitle,
    sharedJoinModeNormalized,
    sharedMaxWeeks,
    sharedMinWeeks,
    sharedTotalSpots,
    sharedWeeklyPricePence,
    router.asPath,
    router.query.id,
  ]);

  useEffect(() => {
    if (stayType !== "day_use") return;
    if (!checkInDate || !checkInTimeLocal) return;
    const startIso = toUtcIso(checkInDate, checkInTimeLocal);
    const start = new Date(startIso);
    const end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
    setCheckOutDate(end.toISOString().slice(0, 10));
    setCheckOutTimeLocal(end.toTimeString().slice(0, 5));
  }, [stayType, checkInDate, checkInTimeLocal]);

  useEffect(() => {
    if (stayType !== resolvedStayType) {
      setStayType(resolvedStayType);
    }
  }, [stayType, resolvedStayType]);

  useEffect(() => {
    if (!isHourlyStay) return;
    if (!checkInDate) return;
    if (stayType === "day_use") return;
    if (checkOutDate !== checkInDate) {
      setCheckOutDate(checkInDate);
    }
  }, [isHourlyStay, checkInDate, checkOutDate, stayType]);

  useEffect(() => {
    if (isHourlyStay) return;
    if (!nightlyRange) return;
    const nextCheckIn = nightlyRange.from ? toDateInputValue(nightlyRange.from) : "";
    const nextCheckOut = nightlyRange.to ? toDateInputValue(nightlyRange.to) : "";
    if (isSharedStayListing && nextCheckIn && nextCheckOut) {
      const incomingKey = `${nextCheckIn}:${nextCheckOut}`;
      if (!isFullWeekDateRange(nextCheckIn, nextCheckOut)) {
        lastSharedParentRangeSkipRef.current = incomingKey;
        if (nextCheckIn !== checkInDate) {
          setCheckInDate((prev) => (prev === nextCheckIn ? prev : nextCheckIn));
        }
        return;
      }
      if (lastSharedParentRangeSkipRef.current === incomingKey) {
        lastSharedParentRangeSkipRef.current = null;
      }
    }
    if (nextCheckIn !== checkInDate) {
      setCheckInDate((prev) => (prev === nextCheckIn ? prev : nextCheckIn));
    }
    if (nextCheckOut !== checkOutDate) {
      setCheckOutDate((prev) => (prev === nextCheckOut ? prev : nextCheckOut));
    }
  }, [nightlyRange, isHourlyStay, isSharedStayListing, checkInDate, checkOutDate]);

  useEffect(() => {
    if (isHourlyStay || isSharedStayListing) return;
    if (!checkInDate) return;
    if (onNightlyRangeChange && nightlyRange && !nightlyRange.to) return;
    if (!checkOutDate || checkOutDate <= checkInDate) {
      const nextCheckOut = addDaysToDateInput(checkInDate, 1);
      setCheckOutDate((prev) => (prev === nextCheckOut ? prev : nextCheckOut));
    }
  }, [isHourlyStay, isSharedStayListing, checkInDate, checkOutDate, onNightlyRangeChange, nightlyRange]);

  useEffect(() => {
    if (!isHourlyStay) return;
    if (stayType === "day_use") return;
    if (!checkInDate || !checkInTimeLocal) return;
    const startIso = toUtcIso(checkInDate, checkInTimeLocal);
    const start = new Date(startIso);
    if (!checkOutDate || !checkOutTimeLocal) return;
    const endIso = toUtcIso(checkOutDate, checkOutTimeLocal);
    const end = new Date(endIso);
    if (Number.isNaN(end.getTime()) || end <= start) {
      const next = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      setCheckOutDate(next.toISOString().slice(0, 10));
      setCheckOutTimeLocal(next.toTimeString().slice(0, 5));
    }
  }, [isHourlyStay, stayType, checkInDate, checkInTimeLocal, checkOutDate, checkOutTimeLocal]);

  const totalGuests = guests.adults + guests.children + guests.infants + guests.pets;

  const disabledSet = useMemo(() => {
    const all = new Set<string>();
    bookedSet.forEach((value) => all.add(value));
    blockedSet.forEach((value) => all.add(value));
    heldSet.forEach((value) => all.add(value));
    return all;
  }, [bookedSet, blockedSet, heldSet]);

  const disabledDates = useMemo(
    () => Array.from(disabledSet).map((date) => parseISODate(date)),
    [disabledSet]
  );
  const getDayDisabledReason = (date: Date): string | null => {
    const key = toISODate(date);
    if (date < availabilityStart) return "before_min_date";
    if (date > dynamicMaxDate) return "after_max_date";
    if (bookedSet.has(key)) return "booked";
    if (blockedSet.has(key)) return "blocked";
    if (heldSet.has(key)) return "held";
    return null;
  };

  const nextUnavailable = useMemo(() => {
    if (!draftStart || draftEnd) return null;
    const startKey = toISODate(draftStart);
    const sorted = Array.from(disabledSet).sort();
    const next = sorted.find((date) => date > startKey);
    return next ? parseISODate(next) : null;
  }, [disabledSet, draftStart, draftEnd]);

  const maxSelectableDate = useMemo(() => addDays(availabilityEnd, -1), [availabilityEnd]);
  const dynamicMaxDate = useMemo(() => {
    if (!draftStart || draftEnd) return maxSelectableDate;
    if (!nextUnavailable) return maxSelectableDate;
    return minDateValue(addDays(nextUnavailable, -1), maxSelectableDate);
  }, [draftStart, draftEnd, nextUnavailable, maxSelectableDate]);

  const durationMs = useMemo(() => {
    if (!checkInDate || !checkOutDate) return 0;
    const start = new Date(toUtcIso(checkInDate, checkInTimeLocal));
    const end = new Date(toUtcIso(checkOutDate, checkOutTimeLocal));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
    return end.getTime() - start.getTime();
  }, [checkInDate, checkInTimeLocal, checkOutDate, checkOutTimeLocal]);

  const billableNights = useMemo(() => {
    if (durationMs <= 0) return 0;
    const diffDays = durationMs / (1000 * 60 * 60 * 24);
    return Math.max(1, Math.ceil(diffDays));
  }, [durationMs]);

  const billableHours = useMemo(() => {
    if (durationMs <= 0) return 0;
    const rawHours = durationMs / (1000 * 60 * 60);
    return Math.max(0.5, Math.ceil(rawHours * 2) / 2);
  }, [durationMs]);

  const billableUnits = stayTypeConfig.isHourly ? billableHours : billableNights;
  const confirmedStayNights = Math.max(1, billableNights || 1);
  const hasSelectedNightRange =
    Boolean(checkInDate) && Boolean(checkOutDate) && checkOutDate > checkInDate;
  const selectedSharedNights = useMemo(() => {
    if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) return 0;
    const start = parseDateInputValue(checkInDate);
    const end = parseDateInputValue(checkOutDate);
    if (!start || !end || end <= start) return 0;
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }, [checkInDate, checkOutDate]);
  const selectedSharedWeeksRaw = selectedSharedNights > 0 ? selectedSharedNights / 7 : 0;
  const selectedSharedWeeks =
    selectedSharedNights > 0 && selectedSharedNights % 7 === 0
      ? Math.round(selectedSharedNights / 7)
      : 0;
  const sharedMinWeeksBase = Math.max(1, Math.round(Number(sharedMinWeeks ?? 1)) || 1);
  const sharedMaxWeeksBase = Math.max(
    sharedMinWeeksBase,
    Math.round(Number(sharedMaxWeeks ?? 12)) || sharedMinWeeksBase
  );
  const isSharedWeeksRangeValid =
    selectedSharedNights > 0 &&
    selectedSharedNights % 7 === 0 &&
    selectedSharedWeeksRaw >= sharedMinWeeksBase &&
    selectedSharedWeeksRaw <= sharedMaxWeeksBase;
  const sharedDateRange = useMemo(
    () => ({
      checkIn: checkInDate || null,
      checkOut: checkOutDate || null,
    }),
    [checkInDate, checkOutDate]
  );

  const {
    options: sharedOptions,
    optionsLoading: sharedOptionsLoading,
    optionsError: sharedOptionsError,
    hasValidRange: hasValidSharedRange,
    refreshOptions: refreshSharedOptions,
    startCheckout: beginSharedCheckout,
  } = useSharedStayCheckout({
    listingId,
    selectedDateRange: sharedDateRange,
    enabled: isSharedStayListing && !isHourlyStay,
  });
  useEffect(() => {
    if (!isSharedStayListing) return;
    debugLog(
      "SHARED_STAY_DATE_DEBUG\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            selected_dates: {
              check_in: checkInDate || null,
              check_out: checkOutDate || null,
            },
            derived: {
              selected_shared_nights: selectedSharedNights,
              selected_shared_weeks_raw: selectedSharedWeeksRaw,
              selected_shared_weeks: selectedSharedWeeks,
              is_shared_weeks_range_valid: isSharedWeeksRangeValid,
              has_valid_shared_range: hasValidSharedRange,
            },
            shared_options_visibility: {
              loading: sharedOptionsLoading,
              hidden_reason: !checkInDate || !checkOutDate
                ? "missing_dates"
                : !isSharedWeeksRangeValid
                ? "invalid_shared_weeks"
                : !hasValidSharedRange
                ? "invalid_shared_range"
                : null,
            },
          },
          null,
          2
        )
    );
  }, [
    checkInDate,
    checkOutDate,
    hasValidSharedRange,
    isSharedStayListing,
    isSharedWeeksRangeValid,
    listingId,
    selectedSharedNights,
    selectedSharedWeeks,
    selectedSharedWeeksRaw,
    sharedOptionsLoading,
  ]);
  const sharedMinWeeksAllowed = Math.max(
    sharedMinWeeksBase,
    Math.round(Number(sharedOptions?.minWeeks ?? sharedMinWeeksBase)) || sharedMinWeeksBase
  );
  const sharedMaxWeeksAllowed = Math.max(
    sharedMinWeeksAllowed,
    Math.round(Number(sharedOptions?.maxWeeks ?? sharedMaxWeeksBase)) || sharedMinWeeksAllowed
  );
  const sharedWeekOptions = useMemo(() => {
    const values: number[] = [];
    for (let week = sharedMinWeeksAllowed; week <= sharedMaxWeeksAllowed; week += 1) {
      values.push(week);
    }
    return values;
  }, [sharedMaxWeeksAllowed, sharedMinWeeksAllowed]);
  const clampedSharedWeeks = Math.min(
    sharedMaxWeeksAllowed,
    Math.max(sharedMinWeeksAllowed, Math.round(Number(startGroupWeeks || sharedMinWeeksAllowed)))
  );
  const sharedPerPersonWeeklyPricePence =
    sharedOptions?.perPersonWeeklyPricePence ?? sharedPerPersonWeeklyPricePenceFromListing;
  const sharedPerPersonWeeklyPricePounds =
    sharedPerPersonWeeklyPricePence != null ? sharedPerPersonWeeklyPricePence / 100 : null;
  const sharedSelectedPricePence =
    isSharedStayListing && isSharedWeeksRangeValid && sharedPerPersonWeeklyPricePence != null
      ? Math.round(Number(sharedPerPersonWeeklyPricePence) * selectedSharedWeeks)
      : null;

  const hostNetUnitPence =
    basePrice && basePrice > 0 ? Math.round(basePrice * 100) : null;
  const hostNetTotalPence =
    basePrice && basePrice > 0 && billableUnits
      ? Math.round(basePrice * billableUnits * 100)
      : null;

  useEffect(() => {
    if (isHourlyStay || isSharedStayListing) {
      setQuote(null);
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }

    // Keep the default nightly price aligned with backend checkout logic even
    // before dates are selected by requesting an indicative 1-night quote.
    const hasSelectedRange =
      Boolean(checkInDate) && Boolean(checkOutDate) && checkOutDate > checkInDate;
    const quoteCheckIn = hasSelectedRange
      ? checkInDate
      : toDateInputValue(startOfDay(new Date()));
    const quoteCheckOut = hasSelectedRange
      ? checkOutDate
      : addDaysToDateInput(quoteCheckIn, 1);

    let cancelled = false;
    const fetchQuote = async () => {
      if (cancelled) return;
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const resp = await fetch("/api/bookings/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listingId,
            checkIn: quoteCheckIn,
            checkOut: quoteCheckOut,
            bookingMode: selectedBookingModeForQuote,
          }),
        });
        if (cancelled) return;
        const payload = await resp.json();
        if (!resp.ok) {
          throw new Error(payload?.error ?? "Failed to fetch quote.");
        }
        if (cancelled) return;
        setQuote(payload);
      } catch (e: any) {
        if (cancelled) return;
        setQuote(null);
        setQuoteError(e?.message ?? "Failed to fetch quote.");
      } finally {
        if (cancelled) return;
        setQuoteLoading(false);
      }
    };

    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [
    checkInDate,
    checkOutDate,
    isHourlyStay,
    isSharedStayListing,
    listingId,
    confirmedStayNights,
    rollingExtraNights,
    selectedBookingModeForQuote,
  ]);

  const fallbackPricing = useMemo(() => {
    if (!hostNetUnitPence) return null;
    if (!stayTypeConfig.isHourly && Number.isInteger(billableNights) && billableNights >= 1) {
      return computeRoundedGuestPricing({
        hostUnitPence: hostNetUnitPence,
        units: billableNights,
        nightsForFeeTier: billableNights,
        isFirstCompletedBooking: false,
      });
    }
    if (hostNetTotalPence) {
      return computeAllInPricing({
        hostNetTotalPence,
        nights: stayTypeConfig.isHourly ? 1 : billableNights,
        isFirstCompletedBooking: false,
      });
    }
    return null;
  }, [billableNights, hostNetTotalPence, hostNetUnitPence, stayTypeConfig.isHourly]);
  const fallbackUnitPrice = useMemo(() => {
    if (!fallbackPricing) return null;
    if ("rounded_guest_unit_pence" in fallbackPricing) {
      return fallbackPricing.rounded_guest_unit_pence / 100;
    }
    return Math.round(fallbackPricing.guest_total_pence / Math.max(1, billableUnits)) / 100;
  }, [billableUnits, fallbackPricing]);

  const guestTotalPence = isSharedStayListing
    ? sharedOptions?.totalPricePence ?? sharedSelectedPricePence
    : quote?.guest_total_pence ??
      (fallbackPricing
        ? "total_guest_pence" in fallbackPricing
          ? fallbackPricing.total_guest_pence
          : fallbackPricing.guest_total_pence
        : null);
  const guestTotal = guestTotalPence != null ? guestTotalPence / 100 : null;
  const guestUnitPrice = useMemo(() => {
    if (isSharedStayListing) {
      if (sharedPerPersonWeeklyPricePounds != null) return sharedPerPersonWeeklyPricePounds;
      return null;
    }
    if (guestTotalPence != null && billableUnits > 0) {
      return Math.round(guestTotalPence / billableUnits) / 100;
    }
    if (quote) return quote.guest_unit_price_pence / 100;
    return fallbackUnitPrice;
  }, [
    billableUnits,
    fallbackUnitPrice,
    guestTotalPence,
    isSharedStayListing,
    quote,
    sharedPerPersonWeeklyPricePounds,
  ]);

  const hasFlexibleModesEnabled = listingAllowsFlexibleStays && listingFlexMode !== "none";
  const rollingFlexAllowed =
    !isHourlyStay &&
    hasFlexibleModesEnabled &&
    Boolean(
      quote?.rolling_flex_allowed ??
        (!hasSelectedNightRange && hasFlexibleModesEnabled)
    );
  const flexMaxExtensionCap = Math.max(
    0,
    Math.round(
      Number(
        quote?.flex_max_extension_nights ??
          quote?.rolling_max_extension_nights ??
          flexMaxExtensionNights ??
          7
      )
    ) || 7
  );
  const flexExtensionNoticeHoursResolved = Math.max(
    1,
    Math.round(Number(quote?.flex_extension_notice_hours ?? flexExtensionNoticeHours ?? 24)) || 24
  );
  const rollingMaxExtensionCap = Math.max(
    0,
    Math.round(Number(quote?.rolling_max_extension_nights ?? flexMaxExtensionCap)) || flexMaxExtensionCap
  );
  const rollingProtectableExtraNights = Math.max(
    0,
    Math.round(
      Number(
        quote?.rolling_flex_max_extension_nights_supported ??
          quote?.rolling_max_extension_nights ??
          flexMaxExtensionNights ??
          14
      )
    ) || 0
  );
  const rollingWindowDays = Math.max(
    1,
    Math.round(Number(quote?.rolling_window_days ?? flexRollingWindowDays ?? 3)) || 3
  );
  const rollingWindowDaysAvailable = Math.max(
    0,
    Math.round(Number(quote?.rolling_flex_window_days_available ?? rollingWindowDays)) || 0
  );
  const rollingHoldWindowNights = Math.max(
    1,
    Math.min(rollingWindowDays, Math.max(rollingWindowDaysAvailable, 1))
  );
  const rollingPricingMultiplier = (() => {
    const parsed = Number(quote?.flex_pricing_multiplier ?? flexPricingMultiplier ?? 1.1);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1.1;
    return Math.min(5, Math.max(1, parsed));
  })();

  const canSelectExtraNight =
    !isHourlyStay &&
    hasFlexibleModesEnabled &&
    Boolean(
      quote?.flex_extra_night_allowed ??
        (!hasSelectedNightRange && hasFlexibleModesEnabled)
    );
  // MVP: keep rolling flex dormant in backend, but hide it from public widget UI.
  const canSelectRolling = false;
  const supportsFlex =
    !isHourlyStay && hasFlexibleModesEnabled && canSelectExtraNight;
  const useFlexibleBooking = selectedBookingType === "flexible" && supportsFlex;
  const activeFlexType = useMemo<FlexTypeChoice | null>(() => {
    if (!useFlexibleBooking) return null;
    if (flexType === "extra_night" && canSelectExtraNight) return "extra_night";
    if (canSelectExtraNight) return "extra_night";
    return null;
  }, [canSelectExtraNight, flexType, useFlexibleBooking]);
  const useRollingBooking = activeFlexType === "rolling";
  const useExtraNightBooking = activeFlexType === "extra_night";
  const rollingMinNights = Math.max(1, confirmedStayNights);
  const rollingRequestedExtraNights = Math.max(1, rollingExtraNights);
  const rollingEffectiveExtraNights = Math.min(
    rollingRequestedExtraNights,
    rollingProtectableExtraNights
  );
  const rollingMaxNights = rollingMinNights + rollingEffectiveExtraNights;
  const rollingAvailabilityState =
    rollingProtectableExtraNights >= rollingRequestedExtraNights
      ? "full"
      : "limited";
  const rollingExtraOptions = useMemo(() => {
    const maxExtra = Math.max(1, rollingMaxExtensionCap);
    const options = ROLLING_EXTRA_OPTIONS.filter((value) => value <= maxExtra);
    if (options.length > 0) return options;
    return [maxExtra];
  }, [rollingMaxExtensionCap]);
  const flexExtraNightAllowed = useExtraNightBooking && Boolean(quote?.flex_extra_night_allowed ?? true);
  const flexExtraNightPrice = useMemo(() => {
    if (isHourlyStay) return null;
    if (quote?.flex_extra_night_price_pence != null) {
      return quote.flex_extra_night_price_pence / 100;
    }
    if (guestUnitPrice != null) {
      const guestUnitPricePence = Math.round(guestUnitPrice * 100);
      const premiumPence = roundGuestPricePenceToNearestFivePounds(
        Math.round(guestUnitPricePence * 1.1)
      );
      return premiumPence / 100;
    }
    return null;
  }, [isHourlyStay, quote?.flex_extra_night_price_pence, guestUnitPrice]);
  const rollingExtensionUnitPrice = useMemo(() => {
    if (!useRollingBooking) return null;
    if (quote?.rolling_extension_unit_price_pence != null) {
      return quote.rolling_extension_unit_price_pence / 100;
    }
    if (guestUnitPrice != null) {
      return Math.round(guestUnitPrice * rollingPricingMultiplier * 100) / 100;
    }
    return null;
  }, [
    guestUnitPrice,
    quote?.rolling_extension_unit_price_pence,
    rollingPricingMultiplier,
    useRollingBooking,
  ]);
  const confirmedStayUnits = stayTypeConfig.isHourly ? billableHours : billableNights;
  const confirmedStayUnitLabel = stayTypeConfig.isHourly ? "hour" : "night";
  const confirmedStayLine =
    confirmedStayUnits > 0
      ? `${formatUnits(confirmedStayUnits)} ${confirmedStayUnitLabel}${
          confirmedStayUnits === 1 ? "" : "s"
        }`
      : null;
  const flexAvailabilityMessage =
    activeFlexType === "rolling"
      ? rollingAvailabilityState === "full"
        ? "Full flexibility available for your dates"
        : "Limited flexibility available for your dates"
      : activeFlexType === "extra_night"
      ? flexExtraNightAllowed
        ? "Full flexibility available for your dates"
        : "Limited flexibility available for your dates"
      : null;
  const selectedFlexModeForUi: FlexMode = useRollingBooking
    ? "rolling"
    : useExtraNightBooking
    ? "extra_night"
    : "none";
  const selectedFlexExtensionNights = useRollingBooking
    ? rollingRequestedExtraNights
    : useExtraNightBooking
    ? 1
    : 0;
  const amountDueTodayPence = Math.max(0, Math.round(Number(quote?.amount_due_today_pence ?? 0)) || 0);
  const sharedJoinableGroups = useMemo(
    () => (sharedOptions?.groups ?? []).filter((group) => group.canJoin),
    [sharedOptions?.groups]
  );
  const hasAnySharedGroup = (sharedOptions?.groups?.length ?? 0) > 0;
  const hasOpenSharedGroup = sharedJoinableGroups.length > 0;
  const sharedSelectedGroup = useMemo(
    () =>
      (sharedOptions?.groups ?? []).find((group) => group.id === selectedSharedGroupId) ??
      (sharedOptions?.groups ?? []).find((group) => group.canJoin) ??
      null,
    [selectedSharedGroupId, sharedOptions?.groups]
  );
  const sharedFilledSpots = sharedSelectedGroup
    ? sharedSelectedGroup.filledSpots + sharedSelectedGroup.activeHolds
    : 0;
  const sharedJoinDisabled =
    !hasValidSharedRange ||
    !isSharedWeeksRangeValid ||
    !checkInDate ||
    !checkOutDate ||
    sharedOptionsLoading ||
    !sharedSelectedGroup ||
    !hasOpenSharedGroup;
  const sharedStartDisabled =
    !hasValidSharedRange ||
    !isSharedWeeksRangeValid ||
    !checkInDate ||
    !checkOutDate ||
    sharedOptionsLoading ||
    Boolean(sharedOptions?.reason) ||
    Boolean(sharedOptions?.groups?.length);
  const hasDateSelection = Boolean(checkInDate) && Boolean(checkOutDate);
  const hasValidDateSelection =
    hasDateSelection &&
    (isHourlyStay ? durationMs > 0 : checkOutDate > checkInDate);
  const ctaState = useMemo<BookingWidgetCtaState>(() => {
    if (isSharedStayListing) {
      if (!hasDateSelection) {
        return {
          label: "Select dates to continue",
          disabled: true,
          reason: "missing_dates",
          helper: "Choose full-week dates to continue.",
        };
      }
      if (!isSharedWeeksRangeValid) {
        return {
          label: "Select full-week dates",
          disabled: true,
          reason: "invalid_shared_weeks",
          helper: "Shared stays must be booked in full weeks.",
        };
      }
      if (!hasValidSharedRange) {
        return {
          label: "Unavailable for selected dates",
          disabled: true,
          reason: "invalid_shared_range",
          helper: "Choose another date range to continue.",
        };
      }
      if (sharedJoinModeNormalized !== "open") {
        return {
          label: "Host approval required",
          disabled: true,
          reason: "shared_approval_mode",
          helper: "This shared stay currently requires host approval.",
        };
      }
      if (sharedOptionsLoading) {
        return {
          label: "Checking availability…",
          disabled: true,
          reason: "shared_options_loading",
          helper: "Checking open groups for these dates.",
        };
      }
      if (sharedOptions?.reason && !hasOpenSharedGroup) {
        return {
          label: "Unavailable for selected dates",
          disabled: true,
          reason: "shared_range_reserved",
          helper: sharedOptions.reason,
        };
      }
      if (hasAnySharedGroup && !hasOpenSharedGroup) {
        return {
          label: "Unavailable for selected dates",
          disabled: true,
          reason: "shared_group_full",
          helper: "This shared stay is already reserved for these dates.",
        };
      }
      if (hasOpenSharedGroup) {
        return {
          label: "Join this stay",
          disabled: false,
          reason: null,
          helper: "Each guest books and pays individually.",
        };
      }
      return {
        label: "Start a new shared stay",
        disabled: false,
        reason: null,
        helper: "Be the first to reserve this shared stay.",
      };
    }

    if (!hasDateSelection) {
      return {
        label: isHourlyStay ? "Select date and time" : "Select dates",
        disabled: true,
        reason: "missing_dates",
        helper: "Select your stay dates to continue.",
      };
    }
    if (!hasValidDateSelection) {
      return {
        label: "Select a valid range",
        disabled: true,
        reason: "invalid_date_range",
        helper: "Check-out must be after check-in.",
      };
    }
    if (totalGuests <= 0) {
      return {
        label: "Add guests",
        disabled: true,
        reason: "missing_guests",
        helper: "Guest count must be at least 1.",
      };
    }
    if (!isHourlyStay && quoteLoading) {
      return {
        label: "Checking price…",
        disabled: true,
        reason: "quote_loading",
        helper: "Please wait while we confirm pricing.",
      };
    }
    if (!isHourlyStay && !quote && quoteError) {
      return {
        label: "Unavailable for selected dates",
        disabled: true,
        reason: "quote_unavailable",
        helper: quoteError,
      };
    }

    return {
      label: useFlexibleBooking ? "Book with flexibility" : "Book this stay",
      disabled: false,
      reason: null,
      helper: useFlexibleBooking
        ? "You can extend your stay without rebooking"
        : "Secure checkout and instant confirmation.",
    };
  }, [
    hasDateSelection,
    isHourlyStay,
    hasValidDateSelection,
    totalGuests,
    quoteLoading,
    quote,
    quoteError,
    useFlexibleBooking,
    isSharedStayListing,
    isSharedWeeksRangeValid,
    hasValidSharedRange,
    sharedJoinModeNormalized,
    sharedOptionsLoading,
    hasAnySharedGroup,
    sharedOptions?.reason,
    hasOpenSharedGroup,
  ]);

  useEffect(() => {
    debugLog(
      "PRICING_DEBUG_WIDGET\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            check_in: checkInDate || null,
            check_out: checkOutDate || null,
            confirmed_nights: confirmedStayNights,
            selected_flex_mode: selectedFlexModeForUi,
            selected_flex_extension_nights: selectedFlexExtensionNights,
            nightly_displayed_price: guestUnitPrice ?? null,
            confirmed_stay_total: guestTotal ?? null,
            pricing_policy: quote?.flex_pricing_policy ?? "incremental_only",
            discount_tier_applied: quote?.discount_tier_applied ?? "none",
            extension_nightly_rate:
              selectedFlexModeForUi === "rolling"
                ? rollingExtensionUnitPrice
                : selectedFlexModeForUi === "extra_night"
                ? flexExtraNightPrice
                : null,
            amount_due_today: amountDueTodayPence / 100,
          },
          null,
          2
        )
    );
  }, [
    amountDueTodayPence,
    checkInDate,
    checkOutDate,
    confirmedStayNights,
    flexExtraNightPrice,
    guestTotal,
    guestUnitPrice,
    listingId,
    quote?.discount_tier_applied,
    quote?.flex_pricing_policy,
    rollingExtensionUnitPrice,
    rollingRequestedExtraNights,
    selectedFlexExtensionNights,
    selectedFlexModeForUi,
    useExtraNightBooking,
    useRollingBooking,
  ]);

  useEffect(() => {
    debugLog(
      "BOOKING_WIDGET_RENDER\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            stay_model: isSharedStayListing ? "shared" : resolvedStayType,
            booking_unit: isHourlyStay ? "hourly" : "nightly",
            booking_type: selectedBookingType,
            flex_type: activeFlexType,
            show_calendar: showCalendar,
          },
          null,
          2
        )
    );
  }, [
    activeFlexType,
    isHourlyStay,
    isSharedStayListing,
    listingId,
    resolvedStayType,
    selectedBookingType,
    showCalendar,
  ]);

  useEffect(() => {
    debugLog(
      "BOOKING_WIDGET_DATE_STATE\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            check_in: checkInDate || null,
            check_out: checkOutDate || null,
            check_in_time: checkInTimeLocal,
            check_out_time: checkOutTimeLocal,
            selected_nights: billableNights,
            selected_hours: billableHours,
            is_hourly: isHourlyStay,
            is_shared: isSharedStayListing,
            has_date_selection: hasDateSelection,
            has_valid_date_selection: hasValidDateSelection,
            is_shared_weeks_range_valid: isSharedWeeksRangeValid,
            has_valid_shared_range: hasValidSharedRange,
            dates_selectable: true,
          },
          null,
          2
        )
    );
  }, [
    billableHours,
    billableNights,
    checkInDate,
    checkInTimeLocal,
    checkOutDate,
    checkOutTimeLocal,
    hasDateSelection,
    hasValidDateSelection,
    hasValidSharedRange,
    isHourlyStay,
    isSharedStayListing,
    isSharedWeeksRangeValid,
    listingId,
  ]);

  useEffect(() => {
    debugLog(
      "BOOKING_WIDGET_CTA_STATE\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            cta_label: loading ? "Reserving…" : ctaState.label,
            cta_hidden: false,
            cta_disabled: loading || ctaState.disabled,
            cta_reason: ctaState.reason,
            helper: ctaState.helper,
            availability_flags: {
              quote_loading: quoteLoading,
              shared_options_loading: sharedOptionsLoading,
              rolling_flex_available: quote?.rolling_flex_available ?? null,
              extra_night_available: quote?.extra_night_available ?? null,
              base_available: quote?.base_available ?? null,
            },
          },
          null,
          2
        )
    );
  }, [ctaState, listingId, loading, quote, quoteLoading, sharedOptionsLoading]);

  useEffect(() => {
    if (selectedBookingType === "flexible" && !supportsFlex) {
      setBookingType("fixed");
    }
  }, [selectedBookingType, supportsFlex]);

  useEffect(() => {
    if (selectedBookingType !== "flexible") return;
    if (canSelectExtraNight && flexType !== "extra_night") {
      setFlexType("extra_night");
      return;
    }
    if (!canSelectExtraNight && flexType !== "extra_night") {
      setFlexType("extra_night");
    }
  }, [canSelectExtraNight, flexType, selectedBookingType]);

  useEffect(() => {
    setRollingExtraNights((prev) => {
      if (rollingExtraOptions.includes(prev)) return prev;
      return rollingExtraOptions[rollingExtraOptions.length - 1] ?? 1;
    });
  }, [rollingExtraOptions, rollingMaxExtensionCap]);

  useEffect(() => {
    if (!useRollingBooking) return;
    const highestSupported = [...rollingExtraOptions]
      .filter((value) => value <= Math.max(1, rollingProtectableExtraNights))
      .pop();
    if (highestSupported && rollingExtraNights > highestSupported) {
      setRollingExtraNights(highestSupported);
    }
  }, [rollingExtraNights, rollingExtraOptions, rollingProtectableExtraNights, useRollingBooking]);

  useEffect(() => {
    if (!showCalendar) return;
    setDraftStart(parseDateInputValue(checkInDate));
    setDraftEnd(parseDateInputValue(checkOutDate));
  }, [showCalendar, checkInDate, checkOutDate]);

  useEffect(() => {
    if (!isSharedStayListing || isHourlyStay || !showCalendar || !draftStart) return;
    const nextEnd = addDays(draftStart, clampedSharedWeeks * 7);
    if (!draftEnd || toDateInputValue(draftEnd) !== toDateInputValue(nextEnd)) {
      setDraftEnd(nextEnd);
    }
  }, [
    clampedSharedWeeks,
    draftEnd,
    draftStart,
    isHourlyStay,
    isSharedStayListing,
    showCalendar,
  ]);

  useEffect(() => {
    if (!isSharedStayListing || isHourlyStay || !checkInDate) return;
    if (isSharedWeeksRangeValid) return;
    const derivedCheckOut = addDaysToDateInput(checkInDate, clampedSharedWeeks * 7);
    if (checkOutDate !== derivedCheckOut) {
      setCheckOutDate((prev) => (prev === derivedCheckOut ? prev : derivedCheckOut));
    }
  }, [
    checkInDate,
    checkOutDate,
    clampedSharedWeeks,
    isHourlyStay,
    isSharedStayListing,
    isSharedWeeksRangeValid,
  ]);

  useEffect(() => {
    if (isHourlyStay) return;
    setAvailabilityStart(startOfDay(new Date()));
    setAvailabilityEnd(addDays(startOfDay(new Date()), 90));
  }, [listingId, isHourlyStay]);

  useEffect(() => {
    if (!showCalendar) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (calendarRef.current?.contains(target)) return;
      if (calendarTriggerRef.current?.contains(target)) return;
      setShowCalendar(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showCalendar]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const updateMonths = () => setCalendarMonths(media.matches ? 2 : 1);
    updateMonths();
    media.addEventListener("change", updateMonths);
    return () => media.removeEventListener("change", updateMonths);
  }, []);

  useEffect(() => {
    if (isHourlyStay || !showCalendar) return;
    if (!hasValidListingId) return;
    const fetchAvailability = async () => {
      const from = toISODate(availabilityStart);
      const to = toISODate(availabilityEnd);
      if (!from || !to || from >= to) return;
      const requestId = latestAvailabilityRequestIdRef.current + 1;
      latestAvailabilityRequestIdRef.current = requestId;
      setAvailabilityLoading(true);
      debugLog(
        "AVAILABILITY_REQUEST_START\n" +
          JSON.stringify(
            {
              listing_id: listingId,
              from,
              to,
              request_id: requestId,
            },
            null,
            2
          )
      );

      try {
        const response = await fetch(
          `/api/listings/${encodeURIComponent(listingId)}/availability?from=${from}&to=${to}`
        );
        const payload = await response.json().catch(() => null);
        const booked = normalizeDayKeys(payload?.booked);
        const blocked = normalizeDayKeys(payload?.blocked);
        const held = normalizeDayKeys(payload?.held);
        const sharedOccupied = normalizeDayKeys(payload?.sharedOccupied);

        debugLog(
          "AVAILABILITY_REQUEST_SUCCESS\n" +
            JSON.stringify(
              {
                listing_id: listingId,
                from,
                to,
                request_id: requestId,
                response_ok: response.ok,
                booked_count: booked.length,
                blocked_count: blocked.length,
                held_count: held.length,
                shared_occupied_count: sharedOccupied.length,
              },
              null,
              2
            )
        );

        if (requestId !== latestAvailabilityRequestIdRef.current) {
          debugLog(
            "AVAILABILITY_REQUEST_IGNORED_STALE\n" +
              JSON.stringify(
                {
                  listing_id: listingId,
                  from,
                  to,
                  request_id: requestId,
                  latest_request_id: latestAvailabilityRequestIdRef.current,
                  booked_count: booked.length,
                  blocked_count: blocked.length,
                  held_count: held.length,
                  shared_occupied_count: sharedOccupied.length,
                },
                null,
                2
              )
          );
          return;
        }

        const hasExpectedShape =
          payload &&
          typeof payload === "object" &&
          Array.isArray(payload.booked) &&
          Array.isArray(payload.blocked) &&
          Array.isArray(payload.held) &&
          Array.isArray(payload.sharedOccupied ?? []);
        if (!response.ok || !hasExpectedShape) {
          debugWarn(
            "AVAILABILITY_RESPONSE_INVALID\n" +
              JSON.stringify(
                {
                  listing_id: listingId,
                  from,
                  to,
                  request_id: requestId,
                  status: response.status,
                },
                null,
                2
              )
          );
          if (!hasAppliedAvailabilityRef.current) {
            setBookedSet(new Set());
            setBlockedSet(new Set());
            setHeldSet(new Set());
            setSharedOccupiedSet(new Set());
          }
          return;
        }

        setBookedSet(new Set(booked));
        setBlockedSet(new Set(blocked));
        setHeldSet(new Set(held));
        setSharedOccupiedSet(new Set(sharedOccupied));
        hasAppliedAvailabilityRef.current = true;
        debugLog(
          "AVAILABILITY_STATE_APPLIED\n" +
            JSON.stringify(
              {
                listing_id: listingId,
                from,
                to,
                request_id: requestId,
                booked_count: booked.length,
                blocked_count: blocked.length,
                held_count: held.length,
                shared_occupied_count: sharedOccupied.length,
              },
              null,
              2
            )
        );
      } catch {
        if (requestId !== latestAvailabilityRequestIdRef.current) {
          debugLog(
            "AVAILABILITY_REQUEST_IGNORED_STALE\n" +
              JSON.stringify(
                {
                  listing_id: listingId,
                  from,
                  to,
                  request_id: requestId,
                  latest_request_id: latestAvailabilityRequestIdRef.current,
                  booked_count: 0,
                  blocked_count: 0,
                  held_count: 0,
                },
                null,
                2
              )
          );
        } else if (!hasAppliedAvailabilityRef.current) {
          setBookedSet(new Set());
          setBlockedSet(new Set());
          setHeldSet(new Set());
          setSharedOccupiedSet(new Set());
        }
      } finally {
        if (requestId === latestAvailabilityRequestIdRef.current) {
          setAvailabilityLoading(false);
        }
      }
    };
    fetchAvailability();
  }, [availabilityStart, availabilityEnd, hasValidListingId, listingId, isHourlyStay, showCalendar]);

  useEffect(() => {
    if (isHourlyStay) return;
    const datePickerDisabledReason = !showCalendar
      ? "calendar_closed"
      : availabilityLoading
      ? "availability_loading"
      : null;
    debugLog(
      "DATE_PICKER_RENDER\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            booking_unit: isHourlyStay ? "hourly" : "nightly",
            stay_model: isSharedStayListing ? "shared" : resolvedStayType,
            selected_mode: isSharedStayListing
              ? "shared"
              : selectedBookingType === "flexible"
              ? `flexible:${activeFlexType ?? "none"}`
              : "fixed",
            show_calendar: showCalendar,
            date_picker_disabled: Boolean(datePickerDisabledReason),
            date_picker_disabled_reason: datePickerDisabledReason,
            check_in: checkInDate || null,
            check_out: checkOutDate || null,
            selected_nights: billableNights,
          },
          null,
          2
        )
    );
  }, [
    activeFlexType,
    billableNights,
    checkInDate,
    checkOutDate,
    isHourlyStay,
    isSharedStayListing,
    listingId,
    resolvedStayType,
    selectedBookingType,
    showCalendar,
    availabilityLoading,
  ]);

  useEffect(() => {
    if (isHourlyStay) return;
    debugLog(
      "DATE_PICKER_AVAILABILITY_INPUT\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            booking_unit: "nightly",
            availability_window: {
              from: toISODate(availabilityStart),
              to: toISODate(availabilityEnd),
            },
            booked_count: bookedSet.size,
            blocked_count: blockedSet.size,
            held_count: heldSet.size,
            shared_occupied_count: sharedOccupiedSet.size,
            disabled_count: disabledSet.size,
            has_applied_availability: hasAppliedAvailabilityRef.current,
          },
          null,
          2
        )
    );
  }, [
    availabilityEnd,
    availabilityStart,
    blockedSet,
    bookedSet,
    disabledSet,
    heldSet,
    isHourlyStay,
    listingId,
    sharedOccupiedSet,
  ]);

  useEffect(() => {
    if (isHourlyStay) return;
    debugLog(
      "DATE_PICKER_SELECTION_STATE\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            check_in: checkInDate || null,
            check_out: checkOutDate || null,
            draft_start: draftStart ? toISODate(draftStart) : null,
            draft_end: draftEnd ? toISODate(draftEnd) : null,
            selected_nights: billableNights,
          },
          null,
          2
        )
    );
  }, [billableNights, checkInDate, checkOutDate, draftEnd, draftStart, isHourlyStay, listingId]);

  useEffect(() => {
    if (!isSharedStayListing || isHourlyStay) {
      setSelectedSharedGroupId(null);
      setStartGroupWeeks(1);
      return;
    }

    setStartGroupWeeks((prev) => {
      const preferred = selectedSharedWeeks > 0 ? selectedSharedWeeks : sharedMinWeeksAllowed;
      const next = Math.min(
        sharedMaxWeeksAllowed,
        Math.max(sharedMinWeeksAllowed, Math.round(Number(preferred) || sharedMinWeeksAllowed))
      );
      if (prev === next) return prev;
      return next;
    });
  }, [
    isHourlyStay,
    isSharedStayListing,
    selectedSharedWeeks,
    sharedMaxWeeksAllowed,
    sharedMinWeeksAllowed,
  ]);

  useEffect(() => {
    if (!isSharedStayListing) return;
    const suggestedGroupId = sharedOptions?.suggestedJoinGroupId ?? null;
    if (suggestedGroupId) {
      setSelectedSharedGroupId((prev) => prev ?? suggestedGroupId);
      return;
    }
    const firstJoinableGroupId = (sharedOptions?.groups ?? []).find((group) => group.canJoin)?.id ?? null;
    if (firstJoinableGroupId) {
      setSelectedSharedGroupId((prev) => prev ?? firstJoinableGroupId);
      return;
    }
    setSelectedSharedGroupId((prev) =>
      prev && sharedOptions?.groups.some((group) => group.id === prev) ? prev : null
    );
  }, [isSharedStayListing, sharedOptions]);

  useEffect(() => {
    if (!isSharedStayListing || !pendingQuickJoinGroupId) return;
    const queuedGroup = (sharedOptions?.groups ?? []).find(
      (group) => group.id === pendingQuickJoinGroupId && group.canJoin
    );
    if (!queuedGroup || !hasValidSharedRange || !isSharedWeeksRangeValid) return;
    setSelectedSharedGroupId(queuedGroup.id);
    setShowJoinSharedModal(true);
    setPendingQuickJoinGroupId(null);
  }, [
    hasValidSharedRange,
    isSharedStayListing,
    isSharedWeeksRangeValid,
    pendingQuickJoinGroupId,
    sharedOptions?.groups,
  ]);

  const getSharedOccupiedDayClassName = (key: string) => {
    if (!sharedOccupiedSet.has(key)) return "";
    const previousKey = addDaysToIsoKey(key, -1);
    const nextKey = addDaysToIsoKey(key, 1);
    const hasPrevious = previousKey ? sharedOccupiedSet.has(previousKey) : false;
    const hasNext = nextKey ? sharedOccupiedSet.has(nextKey) : false;

    if (hasPrevious && hasNext) return "avyro-day-shared-occupied avyro-day-shared-occupied-middle";
    if (hasPrevious) return "avyro-day-shared-occupied avyro-day-shared-occupied-end";
    if (hasNext) return "avyro-day-shared-occupied avyro-day-shared-occupied-start";
    return "avyro-day-shared-occupied avyro-day-shared-occupied-single";
  };

  const handleQuickJoinSharedGroup = (group: SharedGroupOption) => {
    const start = parseDateInputValue(group.startDate);
    const end = parseDateInputValue(group.endDate);
    if (!start || !end) return;

    const totalNights = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const derivedWeeks = Math.max(
      sharedMinWeeksAllowed,
      Math.min(sharedMaxWeeksAllowed, Math.round(totalNights / 7) || sharedMinWeeksAllowed)
    );

    setErr(null);
    setMsg(null);
    setShowSharedCreationFlow(false);
    setSelectedSharedGroupId(group.id);
    setPendingQuickJoinGroupId(group.id);
    setStartGroupWeeks(derivedWeeks);
    setCheckInDate(group.startDate);
    setCheckOutDate(group.endDate);
    setDraftStart(start);
    setDraftEnd(end);
    setShowCalendar(false);
    onNightlyRangeChange?.({ from: start, to: end });
  };

  const handleNightlyRangeSelect = (dates: [Date | null, Date | null]) => {
    const [start, end] = dates;
    const clickedDate = end ?? start;
    const clickedDateKey = clickedDate ? toISODate(clickedDate) : null;
    const clickedDateDisabledReason = clickedDate ? getDayDisabledReason(clickedDate) : null;
    debugLog(
      "DATE_PICKER_DAY_CLICK\n" +
        JSON.stringify(
          {
            listing_id: listingId,
            clicked_date: clickedDateKey,
            clicked_selectable: clickedDate ? !clickedDateDisabledReason : null,
            clicked_disabled_reason: clickedDateDisabledReason,
            next_start: start ? toISODate(start) : null,
            next_end: end ? toISODate(end) : null,
            handler_fired: true,
          },
          null,
          2
        )
    );
    if (clickedDate && clickedDateDisabledReason) {
      debugLog(
        "DATE_PICKER_DISABLED_REASON\n" +
          JSON.stringify(
            {
              listing_id: listingId,
              date: clickedDateKey,
              reason: clickedDateDisabledReason,
            },
            null,
            2
          )
      );
    }
    if (isSharedStayListing && !isHourlyStay) {
      if (!start) {
        setDraftStart(null);
        setDraftEnd(null);
        setCheckInDate("");
        setCheckOutDate("");
        if (onNightlyRangeChange) {
          onNightlyRangeChange({ from: null, to: null });
        }
        return;
      }
      const sharedEnd = addDays(start, clampedSharedWeeks * 7);
      setDraftStart(start);
      setDraftEnd(sharedEnd);
      const nextCheckIn = toDateInputValue(start);
      const nextCheckOut = toDateInputValue(sharedEnd);
      setCheckInDate(nextCheckIn);
      setCheckOutDate(nextCheckOut);
      if (onNightlyRangeChange) {
        onNightlyRangeChange({ from: start, to: sharedEnd });
      }
      return;
    }
    setDraftStart(start);
    setDraftEnd(end);
  };

  const applyNightlyRange = () => {
    if (!draftStart) return;
    const resolvedEnd =
      isSharedStayListing && !isHourlyStay ? addDays(draftStart, clampedSharedWeeks * 7) : draftEnd;
    if (!resolvedEnd) return;
    const nextCheckIn = toDateInputValue(draftStart);
    const nextCheckOut = toDateInputValue(resolvedEnd);
    setCheckInDate(nextCheckIn);
    setCheckOutDate(nextCheckOut);
    if (onNightlyRangeChange) {
      onNightlyRangeChange({ from: draftStart, to: resolvedEnd });
    }
    setShowCalendar(false);
  };

  const clearNightlyRange = () => {
    setDraftStart(null);
    setDraftEnd(null);
    setCheckInDate("");
    setCheckOutDate("");
    if (onNightlyRangeChange) {
      onNightlyRangeChange({ from: null, to: null });
    }
  };

  const dateSummary = useMemo(() => {
    if (!checkInDate || !checkOutDate) return "Add dates";
    const start = parseDateInputValue(checkInDate);
    const end = parseDateInputValue(checkOutDate);
    if (!start || !end) return "Add dates";
    const formatShort = (date: Date) =>
      date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `${formatShort(start)} → ${formatShort(end)}`;
  }, [checkInDate, checkOutDate]);

  const startSharedCheckout = async (action: SharedCheckoutAction) => {
    setErr(null);
    setMsg(null);

    if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
      setErr("Please choose your stay dates.");
      return;
    }
    if (!hasValidSharedRange || !isSharedWeeksRangeValid) {
      setErr("Shared stays must be booked in full weeks within the listing rules.");
      return;
    }
    if (sharedPerPersonWeeklyPricePence == null || sharedPerPersonWeeklyPricePence <= 0) {
      setErr("Shared weekly price is unavailable for this listing.");
      return;
    }
    if (sharedJoinModeNormalized !== "open") {
      setErr("This shared stay currently requires host approval.");
      return;
    }
    const targetSharedGroupId = selectedSharedGroupId ?? sharedSelectedGroup?.id ?? null;

    if (action === "join" && (!targetSharedGroupId || !hasOpenSharedGroup)) {
      setErr("No open shared group is available for these dates. Start a new group instead.");
      return;
    }

    const checkoutCheckOut =
      action === "start" && checkInDate
        ? addDaysToDateInput(checkInDate, clampedSharedWeeks * 7)
        : checkOutDate;

    if (!checkoutCheckOut || checkoutCheckOut <= checkInDate) {
      setErr("Unable to resolve shared-stay dates for checkout.");
      return;
    }

    setSharedCheckoutLoadingAction(action);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const session = sessionData.session;
      if (!session) {
        router.push(`/login?redirect=${encodeURIComponent(router.asPath)}`);
        return;
      }

      const payload = await beginSharedCheckout({
        accessToken: session.access_token,
        action,
        checkIn: checkInDate,
        checkOut: checkoutCheckOut,
        sharedGroupId: action === "join" ? targetSharedGroupId ?? undefined : undefined,
      });

      setShowJoinSharedModal(false);
      setShowStartSharedModal(false);
      setMsg("Redirecting to secure payment…");
      window.location.assign(payload.checkoutUrl);
    } catch (error: any) {
      setErr(error?.message ?? "Unable to start shared stay checkout.");
      await refreshSharedOptions();
    } finally {
      setSharedCheckoutLoadingAction(null);
    }
  };

  const handleReserve = async () => {
    setErr(null);
    setMsg(null);

    if (isSharedStayListing) {
      if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
        setErr("Please choose your stay dates.");
        return;
      }
      if (!isSharedWeeksRangeValid) {
        setErr("Shared stays must be selected in full-week ranges.");
        return;
      }
      if (hasOpenSharedGroup) {
        setShowJoinSharedModal(true);
      } else {
        setShowStartSharedModal(true);
      }
      return;
    }

    if (!checkInDate || !checkOutDate) {
      setErr(isHourlyStay ? "Please choose start and end times." : "Please choose check-in and check-out dates.");
      return;
    }
    if (totalGuests <= 0) {
      setErr("Guest count must be at least 1.");
      return;
    }

    const checkInIso = toUtcIso(checkInDate, checkInTimeLocal);
    const checkOutIso = toUtcIso(checkOutDate, checkOutTimeLocal);
    const checkInAt = new Date(checkInIso);
    const checkOutAt = new Date(checkOutIso);

    if (!Number.isFinite(checkInAt.getTime()) || !Number.isFinite(checkOutAt.getTime())) {
      setErr("Invalid timestamps selected.");
      return;
    }
    if (checkOutAt <= checkInAt) {
      setErr("Check‑out must be after check‑in.");
      return;
    }
    if (!isHourlyStay && checkOutDate <= checkInDate) {
      setErr("Nightly stays must be at least one night. Select a later check‑out date.");
      return;
    }
    if (isHourlyStay && durationMs > 0) {
      const hours = durationMs / (1000 * 60 * 60);
      if (hours < 0.5) {
        setErr("Hourly stays must be at least 30 minutes.");
        return;
      }
    }
    if (!isHourlyStay) {
      if (quoteLoading) {
        setErr("Updating price… please try again in a moment.");
        return;
      }
      if (!quote) {
        setErr(quoteError ?? "Unable to confirm pricing for these dates. Please try again.");
        return;
      }
    }

    setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const session = sessionData.session;
      const user = session?.user ?? null;
      if (!session || !user) {
        router.push(`/login?redirect=${encodeURIComponent(router.asPath)}`);
        return;
      }
      const bookingModeForCreate: FlexMode = useExtraNightBooking
        ? "extra_night"
        : "none";

      const bookingResponse = await fetch("/api/bookings/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          listingId,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          guests: totalGuests,
          bookingMode: bookingModeForCreate,
          flexExtraNight: useExtraNightBooking && flexExtraNightAllowed,
        }),
      });

      if (!bookingResponse.ok) {
        const payload = await bookingResponse.json().catch(() => null);
        if (bookingResponse.status === 403 && payload?.code === "VERIFICATION_REQUIRED") {
          setVerificationRequired(payload.requiredLevel ?? null);
          setShowVerificationModal(true);
          return;
        }
        throw new Error(payload?.error ?? "Failed to create booking.");
      }

      const payload = await bookingResponse.json();
      const bookingId = payload?.bookingId;
      const checkoutUrl = payload?.checkoutUrl;
      if (!bookingId || !checkoutUrl) {
        throw new Error("Booking response missing checkout details.");
      }

      await supabase
        .from("conversations")
        .upsert(
          {
            booking_id: bookingId,
            host_id: hostId,
            guest_id: user.id,
          },
          { onConflict: "booking_id" }
        );

      setMsg("Redirecting to secure payment…");
      window.location.assign(checkoutUrl);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create booking.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full overflow-visible">
      <Card className="space-y-3.5 overflow-visible p-4 shadow-sm md:p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-2xl font-semibold text-slate-900">
          <span className="font-mono tabular-nums">
            {guestUnitPrice ? formatCurrency(guestUnitPrice) : "—"}
          </span>
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {isSharedStayListing ? "/ person / week" : `/ ${stayTypeConfig.unitLabel}`}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between px-0.5 py-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700">
            {resolvedStayType === "day_use" || resolvedStayType === "split_rest" ? (
              <Clock3 className="h-4 w-4" />
            ) : resolvedStayType === "crashpad" ? (
              <CalendarDays className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {isSharedStayListing ? "Stay type: Shared stay" : `Stay type: ${staySummary.label}`}
            </p>
            <p className="truncate text-xs text-slate-500">
              {isSharedStayListing
                ? `${sharedTotalSpots ?? 0} spot${Number(sharedTotalSpots ?? 0) === 1 ? "" : "s"} · Each guest books and pays individually`
                : staySummary.details}
            </p>
          </div>
        </div>
        {isSharedStayListing ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
            Shared
          </span>
        ) : hasFlexibleModesEnabled ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
            <Repeat2 className="h-3.5 w-3.5" />
            Flexible
          </span>
        ) : null}
      </div>

      {!isSharedStayListing ? (
        <>
          <BookingModeSelector
            value={selectedBookingType}
            supportsFlex={supportsFlex}
            showRollingBadge={false}
            onChange={(next) => setBookingType(next)}
          />

          <div
            className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
              selectedBookingType === "flexible" && supportsFlex
                ? "mt-1 grid-rows-[1fr] opacity-100"
                : "pointer-events-none grid-rows-[0fr] opacity-0"
            }`}
          >
            <div
              className={`min-h-0 ${
                selectedBookingType === "flexible" && supportsFlex ? "py-1" : "p-0"
              }`}
            >
              {selectedBookingType === "flexible" && supportsFlex ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-slate-600">
                      Book the stay you need now. Extend if plans change.
                    </p>
                    {flexAvailabilityMessage ? (
                      <p className="mt-2 text-xs font-medium text-slate-700">{flexAvailabilityMessage}</p>
                    ) : null}
                  </div>

                  <AnimatePresence mode="wait" initial={false}>
                    {activeFlexType === "extra_night" ? (
                      <motion.div
                        key="extra-night-panel"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                      >
                        <ExtraNightFlexPanel
                          optionalNightPriceLabel={
                            flexExtraNightPrice != null ? formatCurrency(flexExtraNightPrice) : null
                          }
                          noticeHours={flexExtensionNoticeHoursResolved}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <SharedStaySection
          isSharedStay
          perPersonWeeklyPricePence={sharedPerPersonWeeklyPricePence ?? null}
          totalSpots={sharedSelectedGroup?.totalSpots ?? sharedTotalSpots ?? 0}
          filledSpots={sharedFilledSpots}
          minWeeks={sharedOptions?.minWeeks ?? sharedMinWeeks ?? 1}
          maxWeeks={sharedOptions?.maxWeeks ?? sharedMaxWeeks ?? 12}
          joinMode={sharedJoinModeNormalized}
          selectedDateRange={sharedDateRange}
          sharedOptionsData={sharedOptions}
          loading={sharedOptionsLoading}
          error={sharedOptionsError}
          showCreationFlow={showSharedCreationFlow}
          joinDisabled={sharedJoinDisabled}
          startDisabled={checkInDate && checkOutDate ? sharedStartDisabled : false}
          joinLoading={sharedCheckoutLoadingAction === "join"}
          startLoading={sharedCheckoutLoadingAction === "start"}
          onJoin={() => {
            setErr(null);
            setMsg(null);
            setShowJoinSharedModal(true);
          }}
          onQuickJoinGroup={(group) => {
            handleQuickJoinSharedGroup(group);
          }}
          onStartGroup={() => {
            setErr(null);
            setMsg(null);
            setShowSharedCreationFlow(true);
            setShowCalendar(true);
            calendarTriggerRef.current?.focus();
          }}
        />
      )}

      {isHourlyStay ? (
        <div className="grid gap-3">
          <Label className="text-xs font-medium text-slate-500">
            Dates & time
          </Label>
          <div>
            <Label htmlFor="check-in">Check-in</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Input
                id="check-in-date"
                type="date"
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
              />
              <Input
                id="check-in-time"
                type="time"
                value={checkInTimeLocal}
                onChange={(e) => setCheckInTimeLocal(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="check-out">Check-out</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Input
                id="check-out-date"
                type="date"
                value={checkOutDate}
                onChange={(e) => setCheckOutDate(e.target.value)}
                disabled={isHourlyStay}
              />
              <Input
                id="check-out-time"
                type="time"
                value={checkOutTimeLocal}
                onChange={(e) => setCheckOutTimeLocal(e.target.value)}
                disabled={stayType === "day_use"}
              />
            </div>
          </div>
        </div>
      ) : !isSharedStayListing || showSharedCreationFlow ? (
        <div>
          <Label className="text-xs font-medium text-slate-500">
            {isSharedStayListing ? "Choose shared stay dates" : "Dates"}
          </Label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCalendar(true)}
              className="mt-2 flex w-full items-center justify-between rounded-2xl border border-slate-200 px-3 py-3 text-left text-sm text-[#4B5563] transition hover:border-slate-300"
              aria-expanded={showCalendar}
              ref={calendarTriggerRef}
            >
              <span className="inline-flex items-center gap-2 text-slate-500">
                <CalendarDays className="h-4 w-4" />
                <span className="text-xs font-medium">Dates</span>
              </span>
              <span className="font-medium text-[#0B0D10]">{dateSummary}</span>
            </button>

            {showCalendar && (
              <div
                ref={calendarRef}
                data-availability-loading={availabilityLoading ? "true" : "false"}
                onPointerDownCapture={(event) => {
                  const target = event.target as HTMLElement | null;
                  debugLog(
                    "DATE_PICKER_DAY_CLICK\n" +
                      JSON.stringify(
                        {
                          listing_id: listingId,
                          handler_fired: true,
                          event: "pointer_down_capture",
                          target_class: target?.className ?? null,
                        },
                        null,
                        2
                      )
                  );
                }}
                className="booking-datepicker-popover pointer-events-auto absolute left-0 top-full z-50 mt-3 w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-xl lg:left-auto lg:right-0 lg:w-auto lg:min-w-[660px]"
              >
                <div className="text-base font-medium text-slate-900">Select dates</div>
                <div className="booking-datepicker-wrapper pointer-events-auto mt-3">
                  <DatePicker
                    inline
                    selectsRange
                    startDate={draftStart}
                    endDate={draftEnd}
                    onChange={handleNightlyRangeSelect}
                    monthsShown={calendarMonths}
                    minDate={availabilityStart}
                    maxDate={dynamicMaxDate}
                    excludeDates={disabledDates}
                    onMonthChange={(date) => {
                      const threshold = addDays(availabilityEnd, -30);
                      if (date > threshold) {
                        setAvailabilityEnd((prev) => addDays(prev, 60));
                      }
                    }}
                    dayClassName={(date) => {
                      const key = toISODate(date);
                      const sharedOccupiedClassName = getSharedOccupiedDayClassName(key);
                      if (sharedOccupiedClassName) return sharedOccupiedClassName;
                      if (bookedSet.has(key)) return "avyro-day-booked";
                      if (blockedSet.has(key)) return "avyro-day-blocked";
                      if (heldSet.has(key)) return "avyro-day-held";
                      return "";
                    }}
                    onSelect={(date) => {
                      const dateKey = date ? toISODate(date) : null;
                      const disabledReason = date ? getDayDisabledReason(date) : null;
                      debugLog(
                        "DATE_PICKER_DAY_CLICK\n" +
                          JSON.stringify(
                            {
                              listing_id: listingId,
                              handler_fired: true,
                              event: "on_select",
                              clicked_date: dateKey,
                              clicked_selectable: date ? !disabledReason : null,
                              clicked_disabled_reason: disabledReason,
                            },
                            null,
                            2
                          )
                      );
                      if (disabledReason) {
                        debugLog(
                          "DATE_PICKER_DISABLED_REASON\n" +
                            JSON.stringify(
                              {
                                listing_id: listingId,
                                date: dateKey,
                                reason: disabledReason,
                              },
                              null,
                              2
                            )
                        );
                      }
                    }}
                    calendarClassName="booking-datepicker availability-datepicker"
                    renderCustomHeader={({
                      monthDate,
                      customHeaderCount,
                      decreaseMonth,
                      increaseMonth,
                      prevMonthButtonDisabled,
                      nextMonthButtonDisabled,
                    }) => {
                      const isFirst = customHeaderCount === 0;
                      const isLast = customHeaderCount === calendarMonths - 1;
                      return (
                        <div className="flex items-center justify-between px-2 pb-2 pt-1">
                          <button
                            type="button"
                            onClick={decreaseMonth}
                            disabled={prevMonthButtonDisabled || !isFirst}
                          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-[#0B0D10] hover:border-slate-400 disabled:opacity-0"
                            aria-label="Previous month"
                          >
                            ←
                          </button>
                          <div className="text-sm font-medium text-slate-700">
                            {monthDate.toLocaleDateString("en-GB", {
                              month: "long",
                              year: "numeric",
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={increaseMonth}
                            disabled={nextMonthButtonDisabled || !isLast}
                          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-[#0B0D10] hover:border-slate-400 disabled:opacity-0"
                            aria-label="Next month"
                          >
                            →
                          </button>
                        </div>
                      );
                    }}
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={clearNightlyRange}>
                    Clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={applyNightlyRange}
                    disabled={!draftStart || (!isSharedStayListing && !draftEnd)}
                  >
                    Apply dates
                  </Button>
                </div>
              </div>
            )}
          </div>
          {isSharedStayListing ? (
            <div className="mt-2.5">
              <Label className="text-xs font-medium text-slate-500">Weeks</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {sharedWeekOptions.map((weeksOption) => {
                  const isSelected = clampedSharedWeeks === weeksOption;
                  return (
                    <button
                      key={weeksOption}
                      type="button"
                      onClick={() => {
                        setStartGroupWeeks(weeksOption);
                        if (checkInDate) {
                          setCheckOutDate(addDaysToDateInput(checkInDate, weeksOption * 7));
                        }
                      }}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {weeksOption} week{weeksOption === 1 ? "" : "s"}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {isSharedStayListing && !isHourlyStay && showSharedCreationFlow ? (
        <p className="text-xs text-slate-600">
          {selectedSharedNights > 0
            ? isSharedWeeksRangeValid
              ? `Selected stay: ${selectedSharedWeeks} week${selectedSharedWeeks === 1 ? "" : "s"}.`
              : "Shared stays must be selected in full-week ranges."
            : `Choose dates in full weeks (${sharedOptions?.minWeeks ?? sharedMinWeeks ?? 1}–${
                sharedOptions?.maxWeeks ?? sharedMaxWeeks ?? 12
              } weeks).`}
        </p>
      ) : null}

      {!isSharedStayListing ? (
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">Guests</p>
              <p className="text-sm font-semibold text-slate-900">
                {totalGuests} guest{totalGuests === 1 ? "" : "s"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50"
              onClick={() => setShowGuests((prev) => !prev)}
            >
              Adjust
            </Button>
          </div>
          {showGuests && (
            <div className="mt-3 space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
              {["adults", "children", "infants", "pets"].map((key) => {
                const label =
                  key === "adults"
                    ? "Adults"
                    : key === "children"
                    ? "Children"
                    : key === "infants"
                    ? "Infants"
                    : "Pets";
                const sub =
                  key === "adults"
                    ? "Ages 13+"
                    : key === "children"
                    ? "Ages 2–12"
                    : key === "infants"
                    ? "Under 2"
                    : "";
                return (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{label}</p>
                      {sub && <p className="text-xs text-slate-500">{sub}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          setGuests((g) => ({
                            ...g,
                            [key]: Math.max(0, (g as any)[key] - 1),
                          }))
                        }
                        disabled={(guests as any)[key] <= (key === "adults" ? 1 : 0)}
                      >
                        –
                      </Button>
                      <span className="w-6 text-center text-sm font-semibold">
                        {(guests as any)[key]}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          setGuests((g) => ({
                            ...g,
                            [key]: (g as any)[key] + 1,
                          }))
                        }
                      >
                        +
                      </Button>
                    </div>
                  </div>
                );
              })}
              <div className="mt-2 text-right">
                <Button type="button" size="sm" onClick={() => setShowGuests(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {(isSharedStayListing ? sharedOptionsError : quoteError) && !err && (
        <p className="text-sm text-amber-600">
          {isSharedStayListing ? sharedOptionsError : quoteError}
        </p>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {msg && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}

      <div className="space-y-1.5 pt-0.5">
        <Button
          className="w-full"
          size="lg"
          disabled={loading || ctaState.disabled}
          onClick={handleReserve}
        >
          {loading ? "Reserving…" : ctaState.label}
        </Button>
        {ctaState.helper ? (
          <p className="text-center text-xs text-slate-500">{ctaState.helper}</p>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-slate-100/80 pt-2.5">
        <p className="text-sm font-semibold text-slate-900">Booking summary</p>
        <div className="flex items-start justify-between gap-3 text-sm">
          <div>
            <p className="font-medium text-slate-900">
              {isSharedStayListing
                ? `Cost for selected stay${
                    selectedSharedWeeks > 0
                      ? ` (${selectedSharedWeeks} week${selectedSharedWeeks === 1 ? "" : "s"})`
                      : ""
                  }`
                : `Cost for selected dates ${confirmedStayLine ? `(${confirmedStayLine})` : ""}`}
            </p>
          </div>
          <p className="font-mono text-base font-semibold tabular-nums text-slate-900">
            {guestTotal != null ? formatCurrency(guestTotal) : "—"}
          </p>
        </div>

        {isSharedStayListing ? (
          <div className="space-y-0.5 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Shared spot pricing</p>
            <p>
              {sharedPerPersonWeeklyPricePounds != null
                ? formatCurrency(sharedPerPersonWeeklyPricePounds)
                : "—"}{" "}
              / person / week
            </p>
            <p className="text-xs text-slate-500">Each guest books and pays individually.</p>
          </div>
        ) : useFlexibleBooking ? (
          <div className="space-y-0.5 text-sm text-slate-700">
            {useExtraNightBooking ? (
              <>
                <p className="font-medium text-slate-900">Optional extra night</p>
                <p>
                  {flexExtraNightPrice != null
                    ? `${formatCurrency(flexExtraNightPrice)} if used`
                    : "—"}
                </p>
                <p className="text-xs text-slate-500">
                  Confirm by {flexExtensionNoticeHoursResolved} hours before checkout
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-900">Flexible extension</p>
                <p>
                  From{" "}
                  {rollingExtensionUnitPrice != null
                    ? formatCurrency(rollingExtensionUnitPrice)
                    : "—"}{" "}
                  / night
                </p>
                <p className="text-xs text-slate-500">Only charged if you extend</p>
              </>
            )}
          </div>
        ) : null}

        <div className="rounded-lg bg-slate-50/45 px-3 py-2">
          <p className="text-xs font-medium text-slate-500">Pay today</p>
          <p className="font-mono text-base font-semibold tabular-nums text-slate-900">
            {isSharedStayListing
              ? guestTotalPence != null
                ? formatCurrency(Math.max(0, Math.round(Number(guestTotalPence))) / 100)
                : "—"
              : formatCurrency(amountDueTodayPence / 100)}
          </p>
          <p className="text-xs text-slate-500">
            {isSharedStayListing ? "You’ll pay securely to reserve your spot" : "You won’t be charged yet"}
          </p>
        </div>
      </div>
      </Card>

      {isSharedStayListing ? (
        <>
          <JoinSharedStayModal
            open={showJoinSharedModal}
            onOpenChange={setShowJoinSharedModal}
            selectedDateRange={sharedDateRange}
            joinableGroups={sharedJoinableGroups}
            hasAnyGroups={(sharedOptions?.groups?.length ?? 0) > 0}
            selectedGroupId={selectedSharedGroupId ?? sharedSelectedGroup?.id ?? null}
            onSelectGroup={setSelectedSharedGroupId}
            perPersonWeeklyPricePence={
              sharedPerPersonWeeklyPricePence ?? null
            }
            selectedWeeks={Math.max(1, Math.round(selectedSharedWeeks || startGroupWeeks || 1))}
            loading={sharedCheckoutLoadingAction === "join"}
            error={err}
            onCheckout={() => startSharedCheckout("join")}
            onStartGroup={() => {
              setShowJoinSharedModal(false);
              setShowStartSharedModal(true);
            }}
          />

          <StartSharedGroupModal
            open={showStartSharedModal}
            onOpenChange={setShowStartSharedModal}
            perPersonWeeklyPricePence={
              sharedPerPersonWeeklyPricePence ?? null
            }
            minWeeks={sharedOptions?.minWeeks ?? sharedMinWeeks ?? 1}
            maxWeeks={sharedOptions?.maxWeeks ?? sharedMaxWeeks ?? 12}
            selectedDateRange={sharedDateRange}
            selectedWeeks={startGroupWeeks}
            onWeeksChange={(weeks) => {
              setStartGroupWeeks(weeks);
              if (checkInDate) {
                setCheckOutDate(addDaysToDateInput(checkInDate, Math.max(1, weeks) * 7));
              }
            }}
            loading={sharedCheckoutLoadingAction === "start"}
            error={err}
            onCheckout={() => startSharedCheckout("start")}
          />
        </>
      ) : null}

      <Dialog open={showVerificationModal} onOpenChange={setShowVerificationModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verification required</DialogTitle>
            <DialogDescription>
              Verify for work travel to Instant Book this stay. Required level: {verificationRequired ?? 1}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowVerificationModal(false)}
            >
              Not now
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShowVerificationModal(false);
                router.push("/guest/profile?tab=verification");
              }}
            >
              Verify now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
