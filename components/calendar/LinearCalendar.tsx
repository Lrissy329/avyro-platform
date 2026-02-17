import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import clsx from "clsx";
import type {
  DateRange,
  LinearCalendarEvent,
  LinearCalendarSource,
  RatesByListingDate,
  BookingStatus,
} from "@/lib/calendarTypes";
import {
  addDays,
  diffInDays,
  formatLocalDate,
  rangeToDates,
  startOfDay,
  formatCurrency,
  formatRangeSummary,
} from "@/lib/dateUtils";
import { getChannelMeta } from "@/lib/calendarChannel";

export type { LinearCalendarEvent, LinearCalendarSource } from "@/lib/calendarTypes";

export type LinearCalendarListing = {
  id: string;
  name: string;
  bookingUnit?: "nightly" | "hourly";
  timezone?: string;
};

type SelectionPayload = {
  listingId: string;
  range: DateRange;
};

type LinearCalendarProps = {
  listings: LinearCalendarListing[];
  events: LinearCalendarEvent[];
  startDate: Date;
  endDate: Date;
  selection?: SelectionPayload | null;
  onSelectRange?: (listingId: string, range: DateRange) => void;
  onClearSelection?: () => void;
  ratesByListingDate?: RatesByListingDate;
  hourlyIndicators?: Record<string, Record<string, boolean>>;
  onBookingClick?: (event: LinearCalendarEvent) => void;
  onRequestRangeShift?: (days: number) => void;
};

type TimelineBar = {
  event: LinearCalendarEvent;
  startIdx: number;
  endIdx: number;
  row: number;
};

type LinearCalendarEventWithVisibility = LinearCalendarEvent & {
  visible?: boolean;
};

type TooltipState = {
  event: LinearCalendarEvent;
  listingId: string;
  left: number;
  top: number;
  containerLeft: number;
  containerRight: number;
  containerTop: number;
};

// ---- Layout constants ----
const ROW_HEIGHT = 44; // px, height of each booking lane (was 32)
const ROW_GAP_PX = 8; // vertical gap between lanes
const HEADER_HEIGHT = 80; // px, matches day header height
const DAY_MIN_WIDTH = 72; // px, min width per day column

// Helper: convert event.end (checkout / exclusive) → last stayed night (inclusive)
const getDisplayEnd = (event: LinearCalendarEvent): Date => {
  if (event.end <= event.start) return event.end;
  return addDays(event.end, -1);
};

const buildTimelineBars = (
  listingEvents: LinearCalendarEvent[],
  rangeStart: Date,
  totalDays: number
): { bars: TimelineBar[]; rowCount: number } => {
  const sorted = [...listingEvents].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  const rowEnds: number[] = [];
  const bars: TimelineBar[] = [];

  sorted.forEach((event) => {
    const displayEnd = getDisplayEnd(event);

    const startIdx = diffInDays(event.start, rangeStart);
    const endIdx = diffInDays(displayEnd, rangeStart);

    const clampedStart = Math.max(startIdx, 0);
    const clampedEnd = Math.min(endIdx, totalDays - 1);
    if (clampedEnd < 0 || clampedStart > totalDays - 1) return;

    let row = 0;
    while (rowEnds[row] !== undefined && rowEnds[row] >= clampedStart) {
      row += 1;
    }
    rowEnds[row] = clampedEnd + 0.1;

    bars.push({
      event,
      startIdx: clampedStart,
      endIdx: clampedEnd,
      row,
    });
  });

  return { bars, rowCount: Math.max(rowEnds.length, 1) };
};

export function LinearCalendar({
  listings,
  events,
  startDate,
  endDate,
  selection,
  onSelectRange,
  onClearSelection,
  ratesByListingDate,
  hourlyIndicators,
  onBookingClick,
  onRequestRangeShift,
}: LinearCalendarProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayIso = formatLocalDate(today);

  const totalDays = Math.max(1, diffInDays(endDate, startDate) + 1);
  const rangeEnd = useMemo(
    () => addDays(startDate, totalDays - 1),
    [startDate, totalDays]
  );

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, idx) => addDays(startDate, idx)),
    [startDate, totalDays]
  );

  const normalizedListings = useMemo<LinearCalendarListing[]>(() => {
    if (listings.length) return listings;
    const fallbackIds = Array.from(
      new Set(events.map((event) => event.listingId))
    );
    return fallbackIds.map((id, index) => ({
      id,
      name: `Listing ${index + 1}`,
    }));
  }, [listings, events]);

  const visibleEvents = useMemo(
    () =>
      (events as LinearCalendarEventWithVisibility[]).filter(
        (event) => event.visible !== false
      ),
    [events]
  );

  const eventsByListing = useMemo(() => {
    const map: Record<string, LinearCalendarEvent[]> = {};
    visibleEvents.forEach((event) => {
      if (!map[event.listingId]) map[event.listingId] = [];
      map[event.listingId].push(event);
    });
    return map;
  }, [visibleEvents]);

  // Per-day map for conflict detection / canSelectDate
  const dayMapsByListing = useMemo(() => {
    const map: Record<string, Record<string, LinearCalendarEvent[]>> = {};
    events.forEach((event) => {
      const listingMap = (map[event.listingId] ||= {});
      const displayEnd = getDisplayEnd(event);
      rangeToDates(event.start, displayEnd).forEach((date) => {
        const iso = formatLocalDate(date);
        if (!listingMap[iso]) listingMap[iso] = [];
        listingMap[iso].push(event);
      });
    });
    return map;
  }, [events]);

  const listingLayouts = useMemo(() => {
    return normalizedListings.map((listing) => {
      const listingEvents = eventsByListing[listing.id] ?? [];
      const layout = buildTimelineBars(
        listingEvents,
        startDate,
        totalDays
      );
      return { listing, ...layout };
    });
  }, [normalizedListings, eventsByListing, startDate, totalDays]);

  const timelineRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wheelDeltaRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    lastX: number;
    accumulated: number;
  } | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [selectionState, setSelectionState] = useState<{
    listingId: string;
    anchor: Date;
    draft: Date;
  } | null>(null);
  const isDraggingSelectionRef = useRef(false);
  const selectionStartedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const selectionBounds = useMemo(() => {
    if (selectionState) {
      const { listingId, anchor, draft } = selectionState;
      const start = anchor <= draft ? anchor : draft;
      const end = anchor <= draft ? draft : anchor;
      return { listingId, start, end };
    }
    if (selection) {
      return {
        listingId: selection.listingId,
        start: selection.range.start,
        end: selection.range.end,
      };
    }
    return null;
  }, [selectionState, selection]);

  const canSelectDate = useCallback(
    (listingId: string, date: Date) => {
      if (date < today) return false;
      const iso = formatLocalDate(date);
      const listingMap = dayMapsByListing[listingId];
      return !(listingMap && listingMap[iso] && listingMap[iso].length);
    },
    [dayMapsByListing, today]
  );

  const beginSelection = useCallback(
    (listingId: string, date: Date) => {
      if (!onSelectRange) return; // disable in week view when no handler passed
      if (!canSelectDate(listingId, date)) return;
      selectionStartedRef.current = true;
      isDraggingSelectionRef.current = false;
      setSelectionState({ listingId, anchor: date, draft: date });
    },
    [canSelectDate, onSelectRange]
  );

  const updateSelection = useCallback(
    (listingId: string, date: Date, isDragging = false) => {
      if (!onSelectRange) return;
      if (isDragging) {
        isDraggingSelectionRef.current = true;
        selectionStartedRef.current = false;
      }
      setSelectionState((current) => {
        if (!current || current.listingId !== listingId) return current;
        if (!canSelectDate(listingId, date)) return current;
        return { ...current, draft: date };
      });
    },
    [canSelectDate, onSelectRange]
  );

  useEffect(() => {
    if (!onSelectRange) return;
    const handlePointerUp = () => {
      if (selectionState && selectionBounds && onSelectRange && isDraggingSelectionRef.current) {
        onSelectRange(selectionBounds.listingId, {
          start: selectionBounds.start,
          end: selectionBounds.end,
        });
        setSelectionState(null);
        suppressClickRef.current = true;
        selectionStartedRef.current = false;
      } else if (!selectionState) {
        onClearSelection?.();
      }
      isDraggingSelectionRef.current = false;
    };

    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("touchend", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("touchend", handlePointerUp);
    };
  }, [selectionState, selectionBounds, onSelectRange, onClearSelection]);

  const showTooltip = useCallback(
    (
      listingId: string,
      event: LinearCalendarEvent,
      targetEvent: ReactMouseEvent<HTMLDivElement> | ReactFocusEvent<HTMLDivElement>
    ) => {
      const container = timelineRefs.current[listingId];
      if (!container) {
        setTooltip({
          event,
          listingId,
          left: 0,
          top: 0,
          containerLeft: 0,
          containerRight: 0,
          containerTop: 0,
        });
        return;
      }
      const parentRect = container.getBoundingClientRect();
      const targetRect = targetEvent.currentTarget.getBoundingClientRect();
      setTooltip({
        event,
        listingId,
        left: targetRect.left + targetRect.width / 2,
        top: targetRect.top + targetRect.height / 2,
        containerLeft: parentRect.left,
        containerRight: parentRect.right,
        containerTop: parentRect.top,
      });
    },
    []
  );

  const hideTooltip = useCallback(() => setTooltip(null), []);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!onRequestRangeShift) return;
      const primaryDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.shiftKey
          ? event.deltaY
          : 0;
      if (primaryDelta === 0) return;
      event.preventDefault();
      wheelDeltaRef.current += primaryDelta;
      const threshold = DAY_MIN_WIDTH;
      while (wheelDeltaRef.current >= threshold) {
        onRequestRangeShift(1);
        wheelDeltaRef.current -= threshold;
      }
      while (wheelDeltaRef.current <= -threshold) {
        onRequestRangeShift(-1);
        wheelDeltaRef.current += threshold;
      }
    },
    [onRequestRangeShift]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onRequestRangeShift) return;
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        accumulated: 0,
      };
    },
    [onRequestRangeShift]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId || !onRequestRangeShift) return;
      const deltaX = event.clientX - state.lastX;
      if (deltaX === 0) return;
      event.preventDefault();
      state.lastX = event.clientX;
      state.accumulated += -deltaX;
      const threshold = DAY_MIN_WIDTH;
      while (state.accumulated >= threshold) {
        onRequestRangeShift(1);
        state.accumulated -= threshold;
      }
      while (state.accumulated <= -threshold) {
        onRequestRangeShift(-1);
        state.accumulated += threshold;
      }
    },
    [onRequestRangeShift]
  );

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    wheelDeltaRef.current = 0;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  if (normalizedListings.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white/80 px-6 py-5 text-center text-sm text-slate-500">
        No listings available for this timeline.
      </div>
    );
  }

  const timelineWidthPx = totalDays * DAY_MIN_WIDTH;
  const gridStyle = {
    gridTemplateColumns: `repeat(${totalDays}, minmax(${DAY_MIN_WIDTH}px, 1fr))`,
    minWidth: `${timelineWidthPx}px`,
  };

  return (
    <div className="mt-6">
      <div className="border border-slate-200 rounded-2xl bg-white">
        <div
          ref={scrollerRef}
          className="relative flex overflow-x-auto overflow-y-visible"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          style={{ touchAction: "pan-y" }}
        >
          {/* Left: listing labels */}
          <div className="sticky left-0 z-30 w-52 shrink-0 bg-white border-r border-slate-200 shadow-[4px_0_12px_rgba(15,23,42,0.04)] relative">
            <div
              className="border-b border-slate-200 bg-slate-50/80"
              style={{ height: `${HEADER_HEIGHT}px` }}
            />
            {listingLayouts.map(({ listing, rowCount }, listingIndex) => {
              const rowGapTotal = Math.max(rowCount - 1, 0) * ROW_GAP_PX;
              const paddingY = 16; // matches py-2 top+bottom in grid
              const isStripedRow = listingIndex % 2 === 1;
              return (
                <div
                  key={listing.id}
                  className={clsx(
                    "flex items-center border-b border-slate-200 px-3 text-xs font-medium text-slate-800",
                    isStripedRow && "bg-slate-50/60"
                  )}
                  style={{
                    height: rowCount * ROW_HEIGHT + rowGapTotal + paddingY,
                  }}
                >
                  <span className="truncate">{listing.name}</span>
                </div>
              );
            })}
            <div className="pointer-events-none absolute top-0 right-0 h-full w-6 bg-gradient-to-r from-white via-white/90 to-transparent" />
          </div>

          {/* Right: header + timeline grid */}
          <div
            className="min-w-[600px] flex-1 relative"
            style={{ minWidth: `${timelineWidthPx}px` }}
          >
            {/* Day header */}
            <div
              className="sticky top-0 z-20 grid overflow-hidden bg-white border-b border-slate-200 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400"
              style={{ ...gridStyle, height: `${HEADER_HEIGHT}px` }}
            >
              {days.map((day, idx) => {
                const iso = formatLocalDate(day);
                const isToday = iso === todayIso;
                const weekday = day.getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                const isStripedColumn = idx % 2 === 1;

                const headerBgClass = isToday
                  ? "bg-[#0B0D10]/5"
                  : isWeekend
                  ? "bg-slate-50/80"
                  : isStripedColumn
                  ? "bg-slate-50/60"
                  : "bg-white";

                return (
                  <div
                    key={iso}
                    className={clsx(
                      "relative flex flex-col items-center justify-center gap-1 border-r border-slate-100 py-2 text-center leading-tight",
                      headerBgClass
                    )}
                  >
                    {isToday && (
                      <span className="mb-1 inline-flex items-center rounded-full bg-[#0B0D10] px-2 py-[2px] text-[9px] font-semibold uppercase tracking-[0.16em] text-white">
                        Today
                      </span>
                    )}
                    <div className="leading-tight">
                      {day.toLocaleDateString(undefined, {
                        weekday: "short",
                      })}
                    </div>
                    <div className="mt-0.5 text-slate-700 text-xs font-medium leading-tight font-mono tabular-nums">
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {listingLayouts.map(({ listing, bars, rowCount }, listingIndex) => {
              const selectionOverlay =
                selectionBounds && selectionBounds.listingId === listing.id
                  ? {
                      startIdx: Math.max(
                        0,
                        diffInDays(selectionBounds.start, startDate)
                      ),
                      endIdx: Math.min(
                        totalDays - 1,
                        diffInDays(selectionBounds.end, startDate)
                      ),
                    }
                  : null;

              const isStripedRow = listingIndex % 2 === 1;

              return (
                <div
                  key={listing.id}
                  className={clsx(
                    "border-b border-slate-100",
                    isStripedRow ? "bg-slate-50/40" : "bg-white"
                  )}
                >
                  <div
                    ref={(node) => {
                      timelineRefs.current[listing.id] = node;
                    }}
                    className="relative grid gap-x-2 gap-y-2 px-2 py-2"
                    style={{
                      ...gridStyle,
                      gridTemplateRows: `repeat(${rowCount}, ${ROW_HEIGHT}px)`,
                    }}
                  >
                    {/* Horizontal row separators */}
                    {Array.from({ length: Math.max(rowCount - 1, 0) }).map(
                      (_, idx) => (
                        <div
                          key={`${listing.id}-rowline-${idx}`}
                          className="pointer-events-none absolute left-0 right-0 border-b border-slate-100"
                          style={{
                            top: `${(idx + 1) * ROW_HEIGHT + (idx + 1) * ROW_GAP_PX}px`,
                          }}
                        />
                      )
                    )}

                    {/* Background day hit targets */}
                    {days.map((day, idx) => {
                      const iso = formatLocalDate(day);
                      const rate = ratesByListingDate?.[listing.id]?.[iso];
                      const currencySymbol =
                        rate?.currency === "USD"
                          ? "$"
                          : rate?.currency === "EUR"
                          ? "€"
                          : rate?.currency === "GBP"
                          ? "£"
                          : rate?.currency
                          ? `${rate.currency} `
                          : "£";
                      const isToday = iso === todayIso;
                      const weekday = day.getDay();
                      const isWeekend = weekday === 0 || weekday === 6;
                      const isStripedColumn = idx % 2 === 1;

                      const selectionOverlayActive =
                        selectionOverlay &&
                        idx >= selectionOverlay.startIdx &&
                        idx <= selectionOverlay.endIdx;

                      const selectable = canSelectDate(listing.id, day);
                      const hasHourlyIndicator = Boolean(
                        hourlyIndicators?.[listing.id]?.[iso]
                      );

                      let bgClass: string;
                      if (selectionOverlayActive) {
                        bgClass = "bg-[#FEDD02]/15";
                      } else if (isToday) {
                        bgClass = "bg-[#FEDD02]/15";
                      } else if (isWeekend) {
                        bgClass = "bg-slate-50/80";
                      } else if (isStripedColumn) {
                        bgClass = "bg-slate-50/40";
                      } else {
                        bgClass = "bg-white";
                      }

                      const classNames = clsx(
                        "timeline-hit relative flex h-full w-full flex-col justify-end border-r border-slate-200/70 px-2 py-2 text-[11px] font-medium transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#FEDD02]/40",
                        bgClass,
                        !selectable && "cursor-not-allowed text-slate-300",
                        isToday && "border-r-[#0B0D10]/20"
                      );

                      return (
                        <button
                          key={`${listing.id}-col-${idx}`}
                          type="button"
                          className={classNames}
                          style={{
                            gridColumnStart: idx + 1,
                            gridColumnEnd: idx + 2,
                            gridRowStart: 1,
                            gridRowEnd: rowCount + 1,
                          }}
                          aria-label={`Select ${day.toDateString()}`}
                          aria-disabled={!selectable}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            if (selectionState && selectionState.listingId === listing.id) return;
                            beginSelection(listing.id, day);
                          }}
                          onMouseEnter={(event) => {
                            if (event.buttons !== 1) return;
                            updateSelection(listing.id, day, true);
                          }}
                          onTouchStart={(event) => {
                            event.preventDefault();
                            if (selectionState && selectionState.listingId === listing.id) return;
                            beginSelection(listing.id, day);
                          }}
                          onTouchMove={(event) => {
                            event.preventDefault();
                            updateSelection(listing.id, day, true);
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            if (!onSelectRange) return;
                            if (suppressClickRef.current) {
                              suppressClickRef.current = false;
                              return;
                            }
                            if (!selectionState || selectionState.listingId !== listing.id) {
                              beginSelection(listing.id, day);
                              return;
                            }
                            if (selectionStartedRef.current) {
                              selectionStartedRef.current = false;
                              return;
                            }
                            if (!canSelectDate(listing.id, day)) return;
                            const start = selectionState.anchor <= day ? selectionState.anchor : day;
                            const end = selectionState.anchor <= day ? day : selectionState.anchor;
                            onSelectRange(listing.id, { start, end });
                            setSelectionState(null);
                          }}
                        >
                          {hasHourlyIndicator && (
                            <span className="hourly-indicator absolute left-2 top-2 h-1.5 w-6 rounded-full bg-slate-400/70" />
                          )}
                          {rate && (
                            <span className="pointer-events-none inline-flex max-w-[90%] items-center justify-end self-end text-[11px] font-semibold text-slate-400 font-mono tabular-nums">
                              {currencySymbol}
                              {rate.price}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {/* Selection overlay outline */}
                    {selectionOverlay && (
                      <div
                        className="rounded-2xl border border-dashed border-[#FEDD02]/40 bg-[#FEDD02]/15"
                        style={{
                          gridColumnStart: selectionOverlay.startIdx + 1,
                          gridColumnEnd: selectionOverlay.endIdx + 2,
                          gridRowStart: 1,
                          gridRowEnd: rowCount + 1,
                          pointerEvents: "none",
                          zIndex: 4,
                        }}
                      />
                    )}

                    {/* Booking / block bars */}
                    {bars.map((bar) => {
                      const displayEnd = getDisplayEnd(bar.event);
                      const extendsBefore = bar.event.start < startDate;
                      const extendsAfter = displayEnd > rangeEnd;

                      const hasConflict = rangeToDates(
                        bar.event.start,
                        displayEnd
                      ).some((date) => {
                        const iso = formatLocalDate(date);
                        const entriesForDay =
                          dayMapsByListing[bar.event.listingId]?.[iso] ?? [];
                        return entriesForDay.some(
                          (entry) => entry.id !== bar.event.id
                        );
                      });

                      const status = bar.event.meta?.status as BookingStatus | undefined;
                      const isAwaitingPayment = status === "awaiting_payment";
                      const isApproved = status === "approved";
                      const isPaid = status === "paid";
                      const isConfirmed = status === "confirmed";
                      const isPaymentFailed = status === "payment_failed";
                      const isDeclined = status === "declined";
                      const isCancelled = status === "cancelled";
                      const isBlock = bar.event.meta?.kind === "block";
                      const isManualBlock = isBlock && bar.event.source === "manual";
                      const isExternalBlock = isBlock && bar.event.source !== "manual";
                      const usesCustomColor = !isBlock && ![
                        "booking",
                        "airbnb",
                        "vrbo",
                        "bookingcom",
                        "expedia",
                        "manual",
                      ].includes(bar.event.source);

                      const channelMeta = getChannelMeta(bar.event.source, { isBlock });

                      const barClassName = clsx(
                        "timeline-bar relative flex h-9 items-center rounded-lg px-3 pr-7 text-[11px] font-medium shadow-sm overflow-hidden whitespace-nowrap",
                        extendsBefore && "rounded-l-none",
                        extendsAfter && "rounded-r-none",
                        channelMeta.bgClass,
                        channelMeta.textClass,
                        isAwaitingPayment && "ring-1 ring-slate-300/70",
                        isApproved && "ring-1 ring-emerald-300/70",
                        (isPaid || isConfirmed) && "ring-1 ring-emerald-400/80",
                        isPaymentFailed && "bg-rose-50 text-rose-700 ring-1 ring-rose-300/80",
                        isDeclined && "bg-slate-200 text-slate-500 line-through",
                        isCancelled && "bg-slate-100 text-slate-400 line-through",
                        isManualBlock && "border border-slate-200",
                        isExternalBlock && "border border-slate-200",
                        hasConflict && !isCancelled && !isDeclined && "ring-2 ring-rose-500/80"
                      );

                      const barStyle: CSSProperties = {
                        gridColumnStart: bar.startIdx + 1,
                        gridColumnEnd: bar.endIdx + 2,
                        gridRowStart: bar.row + 1,
                        gridRowEnd: bar.row + 2,
                        zIndex: 3,
                      };

                      if (isBlock) {
                        barStyle.backgroundColor = bar.event.color;
                        barStyle.color = bar.event.textColor ?? "#ffffff";
                      } else if (usesCustomColor) {
                        barStyle.backgroundColor = bar.event.color;
                        barStyle.color = bar.event.textColor ?? "#fff";
                      }

                      return (
                        <div
                          key={`${bar.event.id}-${bar.row}-${bar.startIdx}`}
                          className={barClassName}
                          style={barStyle}
                          tabIndex={0}
                          onClick={() => onBookingClick?.(bar.event)}
                          onMouseEnter={(event) =>
                            showTooltip(listing.id, bar.event, event)
                          }
                          onFocus={(event) =>
                            showTooltip(listing.id, bar.event, event)
                          }
                          onMouseLeave={hideTooltip}
                          onBlur={hideTooltip}
                        >
                          <span className="truncate">{bar.event.label}</span>
                          {isAwaitingPayment && (
                            <span className="ml-2 rounded-full bg-white/70 px-2 py-[1px] text-[9px] uppercase text-slate-600">
                              Awaiting payment
                            </span>
                          )}
                          {isApproved && (
                            <span className="ml-2 rounded-full bg-white/70 px-2 py-[1px] text-[9px] uppercase text-slate-700">
                              Approved
                            </span>
                          )}
                          {(isPaid || isConfirmed) && (
                            <span className="ml-2 rounded-full bg-white/70 px-2 py-[1px] text-[9px] uppercase text-slate-700">
                              Confirmed
                            </span>
                          )}
                          {isPaymentFailed && (
                            <span className="ml-2 rounded-full bg-white/70 px-2 py-[1px] text-[9px] uppercase text-rose-600">
                              Payment failed
                            </span>
                          )}
                          {isDeclined && (
                            <span className="ml-2 rounded-full bg-white/70 px-2 py-[1px] text-[9px] uppercase text-slate-600">
                              Declined
                            </span>
                          )}
                          {isCancelled && (
                            <span className="ml-2 rounded-full bg-white/70 px-2 py-[1px] text-[9px] uppercase text-slate-600">
                              Cancelled
                            </span>
                          )}

                          <span className="absolute right-1 top-1">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 ring-1 ring-black/10">
                              <img
                                src={channelMeta.badgeIcon}
                                alt={channelMeta.label}
                                className="h-4 w-4"
                              />
                            </span>
                          </span>
                        </div>
                      );
                    })}

                    {/* Tooltip */}
                    {tooltip && tooltip.listingId === listing.id && (
                      <div
                        className="pointer-events-none fixed z-50 w-[240px] rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl"
                        style={{
                          left: Math.min(
                            Math.max(tooltip.left - 120, tooltip.containerLeft),
                            Math.max(
                              tooltip.containerRight - 240,
                              tooltip.containerLeft
                            )
                          ),
                          top: Math.max(tooltip.top + 16, tooltip.containerTop),
                        }}
                      >
                        {tooltip.event.badgeLabel && (
                          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                            {tooltip.event.badgeLabel}
                          </p>
                        )}
                        <p className="text-sm font-semibold text-slate-900">
                          {tooltip.event.label}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">
                          {formatRangeSummary(
                            tooltip.event.start,
                            getDisplayEnd(tooltip.event)
                          )}
                          {tooltip.event.meta?.nights
                            ? ` · ${tooltip.event.meta.nights} night${
                                tooltip.event.meta.nights > 1 ? "s" : ""
                              }`
                            : null}
                        </p>
                        {tooltip.event.meta?.nightlyRate && (
                          <p className="text-[11px] text-slate-600">
                            Nightly:{" "}
                            {formatCurrency(
                              tooltip.event.meta.nightlyRate,
                              tooltip.event.meta.currency
                            )}
                          </p>
                        )}
                        {tooltip.event.meta?.total && (
                          <p className="text-[11px] text-slate-600">
                            Total:{" "}
                            {formatCurrency(
                              tooltip.event.meta.total,
                              tooltip.event.meta.currency
                            )}
                          </p>
                        )}
                        {tooltip.event.meta?.reason && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            Reason: {tooltip.event.meta.reason}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
