import { useEffect, useMemo, useState } from "react";
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
  const [calendarMonths, setCalendarMonths] = useState(2);

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
    if (listingId) {
      fetchAvailability().catch(() => {
        setBookedSet(new Set());
        setBlockedSet(new Set());
      });
    }
  }, [listingId, windowStart, windowEnd]);

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
    return "";
  };

  return (
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
  );
}
