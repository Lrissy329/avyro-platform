// components/BookingWidget.tsx
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { computeAllInPricing } from "@/lib/pricing";
import { addDays, startOfDay } from "@/lib/dateUtils";
import DatePicker from "react-datepicker";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BookingStayType } from "@/lib/calendarTypes";

type BookingWidgetProps = {
  listingId: string;
  basePrice: number | null;
  hostId: string;
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
  platform_fee_est_pence: number;
  platform_fee_capped: boolean;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: "all_in_v2_tiers_cap_firstfree";
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
const parseDateInputValue = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};
const parseISODate = (value: string) => new Date(`${value}T00:00:00`);
const minDateValue = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

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
  basePrice,
  hostId,
  bookingUnit,
  rentalType,
  nightlyRange,
  onNightlyRangeChange,
}: BookingWidgetProps) {
  const router = useRouter();
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
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [verificationRequired, setVerificationRequired] = useState<number | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
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

  const toUtcIso = (dateStr: string, timeStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const [hours, minutes] = timeStr.split(":").map(Number);
    const local = new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0);
    return local.toISOString();
  };

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
    if (nextCheckIn !== checkInDate) {
      setCheckInDate(nextCheckIn);
    }
    if (nextCheckOut !== checkOutDate) {
      setCheckOutDate(nextCheckOut);
    }
  }, [nightlyRange, isHourlyStay, checkInDate, checkOutDate]);

  useEffect(() => {
    if (isHourlyStay) return;
    if (!checkInDate) return;
    if (onNightlyRangeChange && nightlyRange && !nightlyRange.to) return;
    if (!checkOutDate || checkOutDate <= checkInDate) {
      setCheckOutDate(addDaysToDateInput(checkInDate, 1));
    }
  }, [isHourlyStay, checkInDate, checkOutDate, onNightlyRangeChange, nightlyRange]);

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
    return all;
  }, [bookedSet, blockedSet]);

  const disabledDates = useMemo(
    () => Array.from(disabledSet).map((date) => parseISODate(date)),
    [disabledSet]
  );

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

  const hostNetUnitPence =
    basePrice && basePrice > 0 ? Math.round(basePrice * 100) : null;
  const hostNetTotalPence =
    basePrice && basePrice > 0 && billableUnits
      ? Math.round(basePrice * billableUnits * 100)
      : null;

  useEffect(() => {
    if (isHourlyStay) {
      setQuote(null);
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }
    if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
      setQuote(null);
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }

    const controller = new AbortController();
    const fetchQuote = async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const resp = await fetch("/api/bookings/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listingId,
            checkIn: checkInDate,
            checkOut: checkOutDate,
          }),
          signal: controller.signal,
        });
        const payload = await resp.json();
        if (!resp.ok) {
          throw new Error(payload?.error ?? "Failed to fetch quote.");
        }
        setQuote(payload);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setQuote(null);
        setQuoteError(e?.message ?? "Failed to fetch quote.");
      } finally {
        setQuoteLoading(false);
      }
    };

    fetchQuote();
    return () => controller.abort();
  }, [checkInDate, checkOutDate, isHourlyStay, listingId]);

  const fallbackPricing = useMemo(
    () =>
      hostNetTotalPence
        ? computeAllInPricing({
            hostNetTotalPence,
            nights: stayTypeConfig.isHourly ? 1 : billableNights,
            isFirstCompletedBooking: false,
          })
        : null,
    [hostNetTotalPence, stayTypeConfig.isHourly, billableNights]
  );
  const fallbackUnitPrice = useMemo(
    () =>
      hostNetUnitPence
        ? computeAllInPricing({
            hostNetTotalPence: hostNetUnitPence,
            nights: stayTypeConfig.isHourly ? 1 : billableNights,
            isFirstCompletedBooking: false,
          }).guest_total_pence / 100
        : null,
    [hostNetUnitPence, stayTypeConfig.isHourly, billableNights]
  );

  const guestUnitPrice = quote
    ? quote.guest_unit_price_pence / 100
    : fallbackUnitPrice;
  const guestTotal = quote
    ? quote.guest_total_pence / 100
    : fallbackPricing
    ? fallbackPricing.guest_total_pence / 100
    : null;

  const effectivePlatformFeeBps = quote?.platform_fee_bps ?? fallbackPricing?.platform_fee_bps ?? null;
  const platformFeeCapped = quote?.platform_fee_capped ?? fallbackPricing?.platform_fee_capped ?? false;

  const commissionLabel = useMemo(() => {
    if (effectivePlatformFeeBps == null) return null;
    if (effectivePlatformFeeBps === 0) return "Commission: Free for first completed booking";
    if (effectivePlatformFeeBps === 800) return "Commission: 8% (28+ nights)";
    if (effectivePlatformFeeBps === 1000) return "Commission: 10% (7+ nights)";
    return "Commission: 12% (1–6 nights)";
  }, [effectivePlatformFeeBps]);
  const friendlySummary = useMemo(() => {
    if (!checkInDate || !checkOutDate) return null;
    const start = new Date(toUtcIso(checkInDate, checkInTimeLocal));
    const end = new Date(toUtcIso(checkOutDate, checkOutTimeLocal));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
    const unitLabel = stayTypeConfig.isHourly ? "hour" : "night";
    const totalUnits = billableUnits > 0 ? `${formatUnits(billableUnits)} ${unitLabel}${billableUnits === 1 ? "" : "s"}` : null;
    const startLabel = stayTypeConfig.isHourly
      ? `${start.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        })} ${start.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const endLabel = stayTypeConfig.isHourly
      ? `${end.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        })} ${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
      : end.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return [
      totalUnits,
      `${startLabel} → ${endLabel}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [
    checkInDate,
    checkInTimeLocal,
    checkOutDate,
    checkOutTimeLocal,
    stayTypeConfig.isHourly,
    billableUnits,
  ]);

  useEffect(() => {
    if (!showCalendar) return;
    setDraftStart(parseDateInputValue(checkInDate));
    setDraftEnd(parseDateInputValue(checkOutDate));
  }, [showCalendar, checkInDate, checkOutDate]);

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
    const fetchAvailability = async () => {
      const from = toISODate(availabilityStart);
      const to = toISODate(availabilityEnd);
      const response = await fetch(
        `/api/listings/${listingId}/availability?from=${from}&to=${to}`
      );
      if (!response.ok) {
        setBookedSet(new Set());
        setBlockedSet(new Set());
        return;
      }
      const payload = await response.json();
      setBookedSet(new Set(payload.booked ?? []));
      setBlockedSet(new Set(payload.blocked ?? []));
    };
    fetchAvailability().catch(() => {
      setBookedSet(new Set());
      setBlockedSet(new Set());
    });
  }, [availabilityStart, availabilityEnd, listingId, isHourlyStay, showCalendar]);

  const handleNightlyRangeSelect = (dates: [Date | null, Date | null]) => {
    const [start, end] = dates;
    setDraftStart(start);
    setDraftEnd(end);
  };

  const applyNightlyRange = () => {
    if (!draftStart || !draftEnd) return;
    if (onNightlyRangeChange) {
      onNightlyRangeChange({ from: draftStart, to: draftEnd });
    } else {
      setCheckInDate(toDateInputValue(draftStart));
      setCheckOutDate(toDateInputValue(draftEnd));
    }
    setShowCalendar(false);
  };

  const clearNightlyRange = () => {
    setDraftStart(null);
    setDraftEnd(null);
    if (onNightlyRangeChange) {
      onNightlyRangeChange({ from: null, to: null });
    } else {
      setCheckInDate("");
      setCheckOutDate("");
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

  const handleReserve = async () => {
    setErr(null);
    setMsg(null);

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
    <div>
      <Card className="space-y-4 p-4 md:p-6 shadow-sm">
      <div className="flex items-baseline justify-between">
        <div className="text-2xl font-semibold text-slate-900">
          <span className="font-mono tabular-nums">
            {guestUnitPrice ? formatCurrency(guestUnitPrice) : "—"}
          </span>
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            / {stayTypeConfig.unitLabel}
          </span>
        </div>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Stay type
        </Label>
        <div className="mt-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{stayTypeConfig.label}</p>
            <p className="mt-1 text-xs text-slate-500">{stayTypeConfig.description}</p>
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Locked by host
            </p>
          </div>
        </div>
      </div>

      {isHourlyStay ? (
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
              Booking window
            </p>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Hourly
            </span>
          </div>
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
      ) : (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
              Booking window
            </p>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Nightly
            </span>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCalendar(true)}
              className="mt-2 flex w-full items-center justify-between rounded-2xl border border-slate-200 px-3 py-3 text-left text-sm text-[#4B5563] transition hover:border-slate-300"
              aria-expanded={showCalendar}
              ref={calendarTriggerRef}
            >
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Dates
              </span>
              <span className="font-medium text-[#0B0D10]">{dateSummary}</span>
            </button>

            {showCalendar && (
              <div
                ref={calendarRef}
                className="booking-datepicker-popover absolute left-0 top-full z-30 mt-3 w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-xl lg:left-auto lg:right-0 lg:w-auto lg:min-w-[660px]"
              >
                <div className="text-base font-medium text-slate-900">Select dates</div>
                <div className="booking-datepicker-wrapper mt-3">
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
                      if (bookedSet.has(key)) return "avyro-day-booked";
                      if (blockedSet.has(key)) return "avyro-day-blocked";
                      return "";
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
                    disabled={!draftStart || !draftEnd}
                  >
                    Apply dates
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-slate-300 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase font-semibold tracking-[0.3em] text-slate-500">
              Guests
            </p>
            <p className="text-sm font-semibold text-slate-900">
              {totalGuests} guest{totalGuests === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
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

      {friendlySummary && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
          {friendlySummary}
        </p>
      )}

      {quoteError && !err && (
        <p className="text-sm text-amber-600">{quoteError}</p>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {msg && <p className="text-sm text-[#14FF62]">{msg}</p>}

      <Button
        className="w-full"
        size="lg"
        disabled={
          loading ||
          !checkInDate ||
          !checkOutDate ||
          billableUnits <= 0 ||
          (!isHourlyStay && checkOutDate <= checkInDate)
        }
        onClick={handleReserve}
      >
        {loading ? "Reserving…" : "Book this stay"}
      </Button>

      {guestTotal != null && (
        <div className="border-t border-slate-100 pt-4 text-sm text-muted-foreground space-y-1.5">
          <div className="text-slate-700">
            <span className="font-mono tabular-nums">
              {formatCurrency(guestUnitPrice ?? 0)}
            </span>{" "}
            × {formatUnits(billableUnits)}{" "}
            {stayTypeConfig.unitLabel}
            {billableUnits === 1 ? "" : "s"}
          </div>
          <p className="text-xs text-muted-foreground">Includes all fees</p>
          {commissionLabel && (
            <p className="text-xs text-slate-500">{commissionLabel}</p>
          )}
          {platformFeeCapped && (
            <p className="text-xs text-slate-500">Commission capped at £150</p>
          )}
          <div className="mt-2 flex justify-between text-base font-semibold text-slate-900">
            <span>Total before taxes</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(guestTotal ?? 0)}
            </span>
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">You won’t be charged yet</p>
      </Card>

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
