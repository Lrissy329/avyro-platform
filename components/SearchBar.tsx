// components/SearchBar.tsx
import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import DatePicker from "react-datepicker";

type InitialQuery = {
  location?: string;
  checkIn?: string;
  checkOut?: string;
  checkInTime?: string;
  checkOutTime?: string;
  bookingUnit?: "hourly" | "nightly";
  guests?: Guests;
};
type Props = {
  onSearch: (filters: any) => void;
  initialQuery?: InitialQuery;
  align?: "left" | "center";
};
type Guests = { adults: number; children: number; infants: number; pets: number };
type StayMode = "overnight" | "day_use";
type DateRange = { from?: Date; to?: Date };

/* Tiny inline icons (no deps) */
const IconPin = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 1 1 18 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const IconCalendar = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const IconUsers = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export default function SearchBar({ onSearch, initialQuery, align = "center" }: Props) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const lastOpenedRef = useRef<"where" | "dates" | "guests" | null>(null);

  const whereInputRef = useRef<HTMLInputElement | null>(null);
  const whereButtonRef = useRef<HTMLButtonElement | null>(null);
  const datesButtonRef = useRef<HTMLButtonElement | null>(null);
  const guestsButtonRef = useRef<HTMLButtonElement | null>(null);

  const [whereQuery, setWhereQuery] = useState("");
  const [showWhere, setShowWhere] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [stayMode, setStayMode] = useState<StayMode>("overnight");
  const [dayUseDate, setDayUseDate] = useState<Date | undefined>(undefined);
  const [dayUseStartTime, setDayUseStartTime] = useState("10:00");
  const [dayUseEndTime, setDayUseEndTime] = useState("16:00");
  const [calendarMonths, setCalendarMonths] = useState(1);
  const [showGuests, setShowGuests] = useState(false);
  const [guests, setGuests] = useState<Guests>({ adults: 0, children: 0, infants: 0, pets: 0 });

  const wherePopoverId = "where-popover";
  const whereListboxId = "where-listbox";
  const datesPopoverId = "dates-popover";
  const guestsPopoverId = "guests-popover";

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setShowWhere(false);
        setShowDates(false);
        setShowGuests(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (showWhere || showDates || showGuests)) {
        setShowWhere(false);
        setShowDates(false);
        setShowGuests(false);
        const last = lastOpenedRef.current;
        if (last === "where") whereButtonRef.current?.focus();
        if (last === "dates") datesButtonRef.current?.focus();
        if (last === "guests") guestsButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showWhere, showDates, showGuests]);

  useEffect(() => { if (showWhere) whereInputRef.current?.focus(); }, [showWhere]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setCalendarMonths(mq.matches ? 2 : 1);
    update();
    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  useEffect(() => {
    if (!initialQuery) return;
    if (initialQuery.location) setWhereQuery(initialQuery.location);
    if (initialQuery.bookingUnit === "hourly") setStayMode("day_use");
    if (initialQuery.bookingUnit === "nightly") setStayMode("overnight");
    if (initialQuery.checkIn) {
      const start = new Date(initialQuery.checkIn);
      if (!Number.isNaN(start.getTime())) {
        if (initialQuery.bookingUnit === "hourly") {
          setDayUseDate(start);
        } else {
          setDateRange((prev) => ({ ...prev, from: start }));
        }
      }
    }
    if (initialQuery.checkOut) {
      const end = new Date(initialQuery.checkOut);
      if (!Number.isNaN(end.getTime())) {
        setDateRange((prev) => ({ ...prev, to: end }));
      }
    }
    if (initialQuery.checkInTime) setDayUseStartTime(initialQuery.checkInTime);
    if (initialQuery.checkOutTime) setDayUseEndTime(initialQuery.checkOutTime);
    if (initialQuery.guests) setGuests(initialQuery.guests);
  }, [initialQuery]);

  const suggestions = [
    { title: "Nearby", subtitle: "Find what’s around you", emoji: "🧭" },
    { title: "London Heathrow (LHR)", subtitle: "Major international hub", emoji: "✈️" },
    { title: "London Gatwick (LGW)", subtitle: "South London / Sussex", emoji: "🛫" },
    { title: "London Stansted (STN)", subtitle: "Essex / East of England", emoji: "🛩️" },
    { title: "London Luton (LTN)", subtitle: "Bedfordshire / North London", emoji: "🧳" },
    { title: "Bath, England", subtitle: "Great for a weekend getaway", emoji: "🏛️" },
    { title: "Barcelona, Spain", subtitle: "Popular beach destination", emoji: "🏖️" },
  ];

  const totalGuests = guests.adults + guests.children + guests.infants + guests.pets;

  const { checkInLabel, checkOutLabel } = useMemo(() => {
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (stayMode === "day_use") {
      return {
        checkInLabel: dayUseDate ? fmt(dayUseDate) : "Add date",
        checkOutLabel:
          dayUseStartTime && dayUseEndTime
            ? `${dayUseStartTime}–${dayUseEndTime}`
            : "Add time",
      };
    }
    const from = (dateRange as DateRange | undefined)?.from;
    const to = (dateRange as DateRange | undefined)?.to;
    return {
      checkInLabel: from ? fmt(from) : "Add dates",
      checkOutLabel: to ? fmt(to) : "Add dates",
    };
  }, [dateRange, stayMode, dayUseDate, dayUseStartTime, dayUseEndTime]);

  const dateTimeLabel = useMemo(() => {
    if (stayMode === "day_use") {
      const dateLabel = dayUseDate ? checkInLabel : "Add date";
      const timeLabel =
        dayUseStartTime && dayUseEndTime
          ? `${dayUseStartTime}–${dayUseEndTime}`
          : "Add time";
      return `${dateLabel} · ${timeLabel}`;
    }
    if (checkInLabel !== "Add dates" && checkOutLabel !== "Add dates") {
      return `${checkInLabel} – ${checkOutLabel}`;
    }
    if (checkInLabel !== "Add dates") return checkInLabel;
    return "Add dates";
  }, [
    stayMode,
    dayUseDate,
    dayUseStartTime,
    dayUseEndTime,
    checkInLabel,
    checkOutLabel,
  ]);

  const addDays = (date: Date, days: number) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

  const timeToMinutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    if (!Number.isFinite(h)) return 0;
    return (h * 60) + (Number.isFinite(m) ? m : 0);
  };

  const minutesToTime = (minutes: number) => {
    const total = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const addHoursToTime = (time: string, hours: number) =>
    minutesToTime(timeToMinutes(time) + hours * 60);

  const handleSearch = () => {
    // Build query object
    const query: Record<string, any> = {};
    if (whereQuery) query.location = whereQuery;
    if (stayMode === "day_use") {
      if (dayUseDate) {
        query.checkIn = dayUseDate.toISOString();
        query.checkOut = dayUseDate.toISOString();
      }
      if (dayUseStartTime) query.checkInTime = dayUseStartTime;
      if (dayUseEndTime) query.checkOutTime = dayUseEndTime;
      query.bookingUnit = "hourly";
    } else {
      if (dateRange?.from) query.checkIn = dateRange.from.toISOString();
      if (dateRange?.to) query.checkOut = dateRange.to.toISOString();
      query.bookingUnit = "nightly";
    }
    if (totalGuests > 0) {
      query.guests = JSON.stringify({ ...guests, total: totalGuests });
    }
    // Push to /search with query params
    router.push({
      pathname: '/search',
      query
    });
    // Retain call to onSearch if provided
    onSearch?.({
      location: whereQuery,
      checkIn: stayMode === "day_use" ? dayUseDate || null : dateRange?.from || null,
      checkOut: stayMode === "day_use" ? dayUseDate || null : dateRange?.to || null,
      checkInTime: stayMode === "day_use" ? dayUseStartTime : null,
      checkOutTime: stayMode === "day_use" ? dayUseEndTime : null,
      bookingUnit: stayMode === "day_use" ? "hourly" : "nightly",
      guests: { ...guests, total: totalGuests },
    });
    setShowWhere(false);
    setShowDates(false);
    setShowGuests(false);
  };

  const openWhere = () => { lastOpenedRef.current = "where"; setShowWhere(v => !v); setShowDates(false); setShowGuests(false); };
  const openDates = () => { lastOpenedRef.current = "dates"; setShowDates(v => !v); setShowWhere(false); setShowGuests(false); };
  const openGuests = () => { lastOpenedRef.current = "guests"; setShowGuests(v => !v); setShowWhere(false); setShowDates(false); };

  const handleStayModeChange = (mode: StayMode) => {
    if (mode === stayMode) return;
    if (mode === "day_use") {
      const seed = dateRange?.from ?? new Date();
      setDayUseDate(seed);
      setDayUseStartTime((prev) => prev || "10:00");
      setDayUseEndTime((prev) => prev || addHoursToTime("10:00", 6));
    } else {
      const seed = dayUseDate ?? new Date();
      setDateRange({ from: seed, to: addDays(seed, 1) });
    }
    setStayMode(mode);
  };

  const chip = (text: string) => (
    <span className="text-sm text-neutral-400">{text}</span>
  );

  const renderCalendarHeader = (monthsShown: number) => ({
    monthDate,
    customHeaderCount,
    decreaseMonth,
    increaseMonth,
    prevMonthButtonDisabled,
    nextMonthButtonDisabled,
  }: {
    monthDate: Date;
    customHeaderCount: number;
    decreaseMonth: () => void;
    increaseMonth: () => void;
    prevMonthButtonDisabled: boolean;
    nextMonthButtonDisabled: boolean;
  }) => {
    const isFirst = customHeaderCount === 0;
    const isLast = customHeaderCount === monthsShown - 1;
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
  };

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full flex items-center ${
        align === "left" ? "justify-start" : "justify-center"
      }`}
    >
      {/* Pill */}
      <div
        className="flex items-center w-full max-w-5xl rounded-2xl border border-neutral-200 bg-white px-3 py-2 shadow-md hover:shadow-lg transition-shadow focus-within:ring-2 focus-within:ring-black/5"
        role="search"
      >
        {/* WHERE */}
        <button
           ref={whereButtonRef}
           type="button"
           onClick={openWhere}
           aria-haspopup="dialog"
           aria-expanded={showWhere}
           aria-controls={wherePopoverId}
           aria-label="Open location search"
           className={`flex-[1.1] min-w-0 md:min-w-[220px] text-left px-4 py-3 min-h-[48px] focus:outline-none bg-transparent`}
         >
          <div className="text-xs tracking-wider font-semibold uppercase text-neutral-500 mb-1">Where</div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center text-neutral-500"><IconPin /></span>
            {whereQuery ? <span className="text-sm font-medium text-neutral-900 truncate">{whereQuery}</span> : chip("Search destinations")}
          </div>
        </button>

        {/* Divider */}
        <div className="hidden sm:block h-8 w-px bg-neutral-200/60" aria-hidden />

        {/* DATE & TIME */}
        <button
          ref={datesButtonRef}
          type="button"
          onClick={openDates}
          aria-haspopup="dialog"
          aria-expanded={showDates}
          aria-controls={datesPopoverId}
          aria-label="Open date and time picker"
          className={`hidden sm:block flex-[1.4] min-w-0 md:min-w-[240px] text-left px-5 py-3 min-h-[48px] focus:outline-none bg-transparent`}
        >
          <div className="text-xs tracking-wider font-semibold uppercase text-neutral-500 mb-1">
            Date &amp; time
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center text-neutral-500"><IconCalendar /></span>
            {dateTimeLabel === "Add dates" ? (
              chip("Add dates")
            ) : (
              <span className="text-sm font-medium text-neutral-900 truncate">{dateTimeLabel}</span>
            )}
          </div>
        </button>

        {/* Divider */}
        <div className="hidden sm:block h-8 w-px bg-neutral-200/60" aria-hidden />

        {/* GUESTS */}
        <button
          ref={guestsButtonRef}
          type="button"
          onClick={openGuests}
          aria-haspopup="dialog"
          aria-expanded={showGuests}
          aria-controls={guestsPopoverId}
          aria-label="Open guests selector"
          className={`flex-[0.9] min-w-0 md:min-w-[160px] text-left px-5 py-3 min-h-[48px] focus:outline-none bg-transparent`}
        >
          <div className="text-xs tracking-wider font-semibold uppercase text-neutral-500 mb-1">Who</div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center text-neutral-500"><IconUsers /></span>
            {totalGuests > 0 ? <span className="text-sm font-medium text-neutral-900 truncate">{`${totalGuests} guests`}</span> : chip("Add guests")}
          </div>
        </button>

        {/* Divider before search */}
        <div className="hidden sm:block h-8 w-px bg-neutral-200/60 mx-1" aria-hidden />
        
        {/* SEARCH BUTTON */}
        <button
          type="button"
          onClick={handleSearch}
          className="ml-2 inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#FEDD02] px-4 text-sm font-semibold text-black shadow-md hover:bg-[#E6C902] active:bg-[#C9B002] hover:shadow-lg active:scale-[0.98] transition focus:outline-none focus:ring-4 focus:ring-[#FEDD02]/40"
          aria-label="Search"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>Search</span>
        </button>
      </div>

      {/* WHERE POPOVER */}
      {showWhere && (
        <div className="absolute top-full left-0 right-0 mt-3 z-30 flex justify-start">
          <div id={wherePopoverId} role="dialog" aria-label="Choose a location" className="w-full max-w-xl rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl">
            <div className="px-2 pb-3">
              <input
                ref={whereInputRef}
                id="where-input"
                value={whereQuery}
                onChange={(e) => setWhereQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                placeholder="Search airports (LHR, LGW, STN, LTN) or destinations"
                className="w-full rounded-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FEDD02]/60"
                role="combobox" aria-expanded={true} aria-autocomplete="list" aria-controls={whereListboxId}
              />
            </div>
            <div className="mb-2 px-2 text-xs font-semibold text-neutral-500">Suggested destinations</div>
            <ul id={whereListboxId} role="listbox" className="max-h-80 overflow-auto">
              {suggestions.filter(s => (whereQuery ? s.title.toLowerCase().includes(whereQuery.toLowerCase()) : true)).map(s => (
                <li key={s.title} role="option" aria-selected={false}>
                  <button type="button" className="w-full rounded-xl px-3 py-3 hover:bg-neutral-50 flex items-center gap-3"
                          onClick={() => { setWhereQuery(s.title); setShowWhere(false); whereButtonRef.current?.focus(); }}>
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-lg">{s.emoji}</span>
                    <span className="text-left">
                      <div className="text-sm font-medium text-neutral-900">{s.title}</div>
                      <div className="text-xs text-neutral-500">{s.subtitle}</div>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* DATES POPOVER */}
      {showDates && (
        <div className="absolute top-full left-1/2 mt-3 z-30 w-full max-w-3xl -translate-x-1/2">
          <div id={datesPopoverId} role="dialog" aria-label="Choose dates" className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStayModeChange("overnight")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    stayMode === "overnight"
                      ? "border-[#FEDD02] bg-[#FEDD02] text-black"
                      : "border-neutral-300 text-neutral-700 hover:border-neutral-500"
                  }`}
                >
                  Overnight
                </button>
                <button
                  type="button"
                  onClick={() => handleStayModeChange("day_use")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    stayMode === "day_use"
                      ? "border-[#FEDD02] bg-[#FEDD02] text-black"
                      : "border-neutral-300 text-neutral-700 hover:border-neutral-500"
                  }`}
                >
                  Day-use
                </button>
              </div>
              <div className="text-xs text-neutral-500">
                {stayMode === "day_use" ? "Same-day stays with a time window." : "Standard overnight stays."}
              </div>
            </div>

            {stayMode === "overnight" ? (
              <>
                <div className="flex items-center gap-2 px-2 pb-2" aria-hidden>
                  {["Exact dates", "± 1 day", "± 2 days", "± 3 days", "± 7 days", "± 14 days"].map(label => (
                    <span key={label} className="text-xs px-3 py-1 rounded-full border border-neutral-300 text-neutral-600">{label}</span>
                  ))}
                </div>
                <div className="booking-datepicker-wrapper">
                  <DatePicker
                    inline
                    selectsRange
                    startDate={dateRange?.from ?? null}
                    endDate={dateRange?.to ?? null}
                    onChange={(dates) => {
                      const [start, end] = dates as [Date | null, Date | null];
                      setDateRange({
                        from: start ?? undefined,
                        to: end ?? undefined,
                      });
                    }}
                    monthsShown={calendarMonths}
                    calendarStartDay={1}
                    calendarClassName="booking-datepicker"
                    renderCustomHeader={renderCalendarHeader(calendarMonths)}
                  />
                </div>
              </>
            ) : (
              <div className="grid gap-4 px-2">
                <DatePicker
                  inline
                  selected={dayUseDate ?? null}
                  onChange={(date) => setDayUseDate(date ?? undefined)}
                  monthsShown={1}
                  calendarStartDay={1}
                  calendarClassName="booking-datepicker"
                  renderCustomHeader={renderCalendarHeader(1)}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-neutral-700">
                    Start time
                    <input
                      type="time"
                      value={dayUseStartTime}
                      onChange={(e) => {
                        const next = e.target.value;
                        setDayUseStartTime(next);
                        if (timeToMinutes(dayUseEndTime) <= timeToMinutes(next)) {
                          setDayUseEndTime(addHoursToTime(next, 6));
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-neutral-700">
                    End time
                    <input
                      type="time"
                      value={dayUseEndTime}
                      onChange={(e) => setDayUseEndTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* GUESTS POPOVER */}
      {showGuests && (
        <div className="absolute top-full right-0 mt-3 z-30 w-full max-w-lg">
          <div id={guestsPopoverId} role="dialog" aria-label="Choose guests" className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl">
            {[
              { key: "adults", label: "Adults", sub: "Ages 13 or above" },
              { key: "children", label: "Children", sub: "Ages 2–12" },
              { key: "infants", label: "Infants", sub: "Under 2" },
              { key: "pets", label: "Pets", sub: "" },
            ].map(row => (
              <div key={row.key} className="flex items-center justify-between py-3 border-b last:border-0">
                <div>
                  <div className="text-sm font-medium text-neutral-900">{row.label}</div>
                  {row.sub && <div className="text-xs text-neutral-500">{row.sub}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" className="h-8 w-8 rounded-full border border-neutral-300 flex items-center justify-center disabled:opacity-40 hover:bg-neutral-50"
                          aria-label={`Decrease ${row.label.toLowerCase()}`} disabled={(guests as any)[row.key] <= 0}
                          onClick={() => setGuests(g => ({ ...g, [row.key]: Math.max(0, (g as any)[row.key] - 1) }))}>–</button>
                  <span className="w-4 text-center text-sm" aria-live="polite">{(guests as any)[row.key]}</span>
                  <button type="button" className="h-8 w-8 rounded-full border border-neutral-300 flex items-center justify-center hover:bg-neutral-50"
                          aria-label={`Increase ${row.label.toLowerCase()}`}
                          onClick={() => setGuests(g => ({ ...g, [row.key]: (g as any)[row.key] + 1 }))}>+</button>
                </div>
              </div>
            ))}
            <div className="pt-3 text-right">
              <button type="button" className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm" onClick={() => setShowGuests(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
