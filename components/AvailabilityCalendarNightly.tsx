import { useEffect, useMemo, useRef, useState } from "react";
import DatePicker from "react-datepicker";

import { addDays, startOfDay } from "@/lib/dateUtils";

type NightlyRange = {
  from: Date | null;
  to: Date | null;
};

type AvailabilityCalendarNightlyProps = {
  listingId: string;
  selectedRange: NightlyRange;
  onSelectRange: (nextRange: NightlyRange) => void;
};

const WINDOW_DAYS = 90;
const EXTEND_DAYS = 60;

const toISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseISODate = (value: string) => new Date(`${value}T00:00:00`);

const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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
const ENABLE_AVAILABILITY_DEBUG =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEBUG_AVAILABILITY === "1";
const debugLog = (message: string) => {
  if (!ENABLE_AVAILABILITY_DEBUG) return;
  console.log(message);
};
const debugWarn = (message: string) => {
  if (!ENABLE_AVAILABILITY_DEBUG) return;
  console.warn(message);
};

export default function AvailabilityCalendarNightly({
  listingId,
  selectedRange,
  onSelectRange,
}: AvailabilityCalendarNightlyProps) {
  const [windowStart, setWindowStart] = useState(() => startOfDay(new Date()));
  const [windowEnd, setWindowEnd] = useState(() =>
    addDays(startOfDay(new Date()), WINDOW_DAYS)
  );
  const [bookedSet, setBookedSet] = useState<Set<string>>(new Set());
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [heldSet, setHeldSet] = useState<Set<string>>(new Set());
  const [calendarMonths, setCalendarMonths] = useState(2);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const latestAvailabilityRequestIdRef = useRef(0);

  useEffect(() => {
    setWindowStart(startOfDay(new Date()));
    setWindowEnd(addDays(startOfDay(new Date()), WINDOW_DAYS));
  }, [listingId]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const updateMonths = () => setCalendarMonths(media.matches ? 2 : 1);
    updateMonths();
    media.addEventListener("change", updateMonths);
    return () => media.removeEventListener("change", updateMonths);
  }, []);

  useEffect(() => {
    const fetchAvailability = async () => {
      const from = toISODate(windowStart);
      const to = toISODate(windowEnd);
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

      let payload: any = null;
      try {
        const response = await fetch(
          `/api/listings/${listingId}/availability?from=${from}&to=${to}`
        );
        payload = await response.json().catch(() => null);
        const booked = normalizeDayKeys(payload?.booked);
        const blocked = normalizeDayKeys(payload?.blocked);
        const held = normalizeDayKeys(payload?.held);

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
                },
                null,
                2
              )
          );
          return;
        }

        if (!response.ok) {
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
          return;
        }

        const hasExpectedShape =
          payload &&
          typeof payload === "object" &&
          Array.isArray(payload.booked) &&
          Array.isArray(payload.blocked) &&
          Array.isArray(payload.held);
        if (!hasExpectedShape) {
          debugWarn(
            "AVAILABILITY_RESPONSE_MALFORMED\n" +
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
          return;
        }

        setBookedSet(new Set(booked));
        setBlockedSet(new Set(blocked));
        setHeldSet(new Set(held));
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
        }
      } finally {
        if (requestId === latestAvailabilityRequestIdRef.current) {
          setAvailabilityLoading(false);
        }
      }
    };
    if (listingId) {
      fetchAvailability();
    }
  }, [listingId, windowStart, windowEnd]);

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

  const nextUnavailable = useMemo(() => {
    if (!selectedRange.from || selectedRange.to) return null;
    const startKey = toISODate(selectedRange.from);
    const sorted = Array.from(disabledSet).sort();
    const next = sorted.find((date) => date > startKey);
    return next ? parseISODate(next) : null;
  }, [disabledSet, selectedRange.from, selectedRange.to]);

  const maxSelectableDate = useMemo(() => addDays(windowEnd, -1), [windowEnd]);
  const dynamicMaxDate = useMemo(() => {
    if (!selectedRange.from || selectedRange.to) return maxSelectableDate;
    if (!nextUnavailable) return maxSelectableDate;
    return minDate(addDays(nextUnavailable, -1), maxSelectableDate);
  }, [selectedRange.from, selectedRange.to, nextUnavailable, maxSelectableDate]);

  const handleMonthChange = (date: Date) => {
    const threshold = addDays(windowEnd, -30);
    if (date > threshold) {
      setWindowEnd((prev) => addDays(prev, EXTEND_DAYS));
    }
  };

  const dayClassName = (date: Date) => {
    const key = toISODate(date);
    if (bookedSet.has(key)) return "avyro-day-booked";
    if (blockedSet.has(key)) return "avyro-day-blocked";
    if (heldSet.has(key)) return "avyro-day-held";
    return "";
  };

  return (
    <div data-availability-loading={availabilityLoading ? "true" : "false"}>
      <DatePicker
        inline
        selectsRange
        startDate={selectedRange.from}
        endDate={selectedRange.to}
        onChange={(dates) => {
          const [start, end] = dates as [Date | null, Date | null];
          onSelectRange({ from: start, to: end });
        }}
        minDate={windowStart}
        maxDate={dynamicMaxDate}
        excludeDates={disabledDates}
        monthsShown={calendarMonths}
        onMonthChange={handleMonthChange}
        calendarClassName="booking-datepicker availability-datepicker"
        dayClassName={dayClassName}
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
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-[#0B0D10] hover:border-slate-400 disabled:opacity-0"
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
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-[#0B0D10] hover:border-slate-400 disabled:opacity-0"
                aria-label="Next month"
              >
                →
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}
