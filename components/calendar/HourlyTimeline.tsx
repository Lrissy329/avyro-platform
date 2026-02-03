import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
} from "react";
import clsx from "clsx";

import type { LinearCalendarEvent } from "@/lib/calendarTypes";
import { addDays, startOfDayInTimeZone } from "@/lib/dateUtils";
import type { LinearCalendarListing } from "@/components/calendar/LinearCalendar";

const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 56;
const SLOT_MINUTES = 30;
const TOTAL_SLOTS = 48;
const SLOT_MIN_WIDTH = 36;

const addMinutes = (date: Date, minutes: number) => {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
};

type SelectionState = {
  listingId: string;
  anchorSlot: number;
  draftSlot: number;
};

type HourlyTimelineProps = {
  listings: LinearCalendarListing[];
  events: LinearCalendarEvent[];
  date: Date;
  selection?: { listingId: string; start: Date; end: Date } | null;
  onSelectRange?: (listingId: string, start: Date, end: Date) => void;
  onClearSelection?: () => void;
  onBookingClick?: (event: LinearCalendarEvent) => void;
  onRequestDayShift?: (days: number) => void;
  timezone?: string;
};

export function HourlyTimeline({
  listings,
  events,
  date,
  selection,
  onSelectRange,
  onClearSelection,
  onBookingClick,  timezone = "Europe/London",
}: HourlyTimelineProps) {
  const dayStart = useMemo(() => startOfDayInTimeZone(date, timezone), [date, timezone]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);
  const slots = useMemo(() => Array.from({ length: TOTAL_SLOTS }, (_, idx) => idx), []);

  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const isDraggingSelectionRef = useRef(false);
  const selectionStartedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const selectionBounds = useMemo(() => {
    if (selectionState) {
      const startSlot = Math.min(selectionState.anchorSlot, selectionState.draftSlot);
      const endSlot = Math.max(selectionState.anchorSlot, selectionState.draftSlot);
      return {
        listingId: selectionState.listingId,
        startSlot,
        endSlot,
      };
    }
    if (selection) {
      const startMinutes = (selection.start.getTime() - dayStart.getTime()) / 60000;
      const endMinutes = (selection.end.getTime() - dayStart.getTime()) / 60000;
      const startSlot = Math.max(0, Math.floor(startMinutes / SLOT_MINUTES));
      const endSlot = Math.max(startSlot, Math.ceil(endMinutes / SLOT_MINUTES) - 1);
      return {
        listingId: selection.listingId,
        startSlot,
        endSlot,
      };
    }
    return null;
  }, [selectionState, selection, dayStart]);

  const beginSelection = useCallback(
    (listingId: string, slot: number) => {
      if (!onSelectRange) return;
      selectionStartedRef.current = true;
      isDraggingSelectionRef.current = false;
      setSelectionState({ listingId, anchorSlot: slot, draftSlot: slot });
    },
    [onSelectRange]
  );

  const updateSelection = useCallback(
    (listingId: string, slot: number, isDragging = false) => {
      if (!onSelectRange) return;
      if (isDragging) {
        isDraggingSelectionRef.current = true;
        selectionStartedRef.current = false;
      }
      setSelectionState((current) => {
        if (!current || current.listingId !== listingId) return current;
        return { ...current, draftSlot: slot };
      });
    },
    [onSelectRange]
  );

  useEffect(() => {
    if (!onSelectRange) return;
    const handlePointerUp = () => {
      if (selectionState && selectionBounds && isDraggingSelectionRef.current) {
        const startSlot = selectionBounds.startSlot;
        const endSlot = selectionBounds.endSlot + 1;
        const startAt = addMinutes(dayStart, startSlot * SLOT_MINUTES);
        const endAt = addMinutes(dayStart, endSlot * SLOT_MINUTES);
        onSelectRange(selectionBounds.listingId, startAt, endAt);
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
  }, [selectionState, selectionBounds, onSelectRange, onClearSelection, dayStart]);

  const eventsByListing = useMemo(() => {
    const map: Record<string, LinearCalendarEvent[]> = {};
    events.forEach((event) => {
      if (event.end <= dayStart || event.start >= dayEnd) return;
      const list = (map[event.listingId] ||= []);
      list.push(event);
    });
    return map;
  }, [events, dayStart, dayEnd]);

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${TOTAL_SLOTS}, minmax(${SLOT_MIN_WIDTH}px, 1fr))`,
    minWidth: `${TOTAL_SLOTS * SLOT_MIN_WIDTH}px`,
  };

  const headerHours = useMemo(() => Array.from({ length: 24 }, (_, idx) => idx), []);

  return (
    <div className="mt-6">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex overflow-x-auto">
          <div className="sticky left-0 z-20 w-52 shrink-0 border-r border-slate-200 bg-white">
            <div
              className="border-b border-slate-200 bg-slate-50/80"
              style={{ height: `${HEADER_HEIGHT}px` }}
            />
            {listings.map((listing) => (
              <div
                key={listing.id}
                className="flex items-center border-b border-slate-200 px-3 text-xs font-medium text-slate-800"
                style={{ height: `${ROW_HEIGHT}px` }}
              >
                <span className="truncate">{listing.name}</span>
              </div>
            ))}
          </div>

          <div className="relative flex-1" style={{ minWidth: `${TOTAL_SLOTS * SLOT_MIN_WIDTH}px` }}>
            <div
              className="sticky top-0 z-10 grid border-b border-slate-200 bg-white text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400"
              style={{ ...gridStyle, height: `${HEADER_HEIGHT}px` }}
            >
              {headerHours.map((hour) => (
                <div
                  key={`hour-${hour}`}
                  className="flex items-center justify-center border-r border-slate-100 font-mono tabular-nums"
                  style={{ gridColumnStart: hour * 2 + 1, gridColumnEnd: hour * 2 + 3 }}
                >
                  {String(hour).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {listings.map((listing) => {
              const listingEvents = eventsByListing[listing.id] ?? [];
              const selectionOverlay =
                selectionBounds && selectionBounds.listingId === listing.id
                  ? selectionBounds
                  : null;

              return (
                <div key={listing.id} className="border-b border-slate-100">
                  <div
                    className="relative grid"
                    style={{ ...gridStyle, height: `${ROW_HEIGHT}px` }}
                  >
                    {slots.map((slot) => (
                      <button
                        key={`${listing.id}-slot-${slot}`}
                        type="button"
                        className={clsx(
                          "relative h-full border-r border-slate-100 text-[10px] text-transparent hover:bg-slate-50",
                          slot % 2 === 1 && "bg-slate-50/30"
                        )}
                        style={{
                          gridColumnStart: slot + 1,
                          gridColumnEnd: slot + 2,
                        }}
                        onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => {
                          event.preventDefault();
                          if (selectionState && selectionState.listingId === listing.id) return;
                          beginSelection(listing.id, slot);
                        }}
                        onMouseEnter={(event: ReactMouseEvent<HTMLButtonElement>) => {
                          if (event.buttons !== 1) return;
                          updateSelection(listing.id, slot, true);
                        }}
                        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                          event.preventDefault();
                          if (!onSelectRange) return;
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          if (!selectionState || selectionState.listingId !== listing.id) {
                            beginSelection(listing.id, slot);
                            return;
                          }
                          if (selectionStartedRef.current) {
                            selectionStartedRef.current = false;
                            return;
                          }
                          const startSlot = Math.min(selectionState.anchorSlot, slot);
                          const endSlot = Math.max(selectionState.anchorSlot, slot) + 1;
                          const startAt = addMinutes(dayStart, startSlot * SLOT_MINUTES);
                          const endAt = addMinutes(dayStart, endSlot * SLOT_MINUTES);
                          onSelectRange(listing.id, startAt, endAt);
                          setSelectionState(null);
                        }}
                      />
                    ))}

                    {selectionOverlay && (
                      <div
                        className="rounded-md border border-dashed border-[#FEDD02]/40 bg-[#FEDD02]/15"
                        style={{
                          gridColumnStart: selectionOverlay.startSlot + 1,
                          gridColumnEnd: selectionOverlay.endSlot + 2,
                          gridRowStart: 1,
                          gridRowEnd: 2,
                          pointerEvents: "none",
                          zIndex: 3,
                        }}
                      />
                    )}

                    {listingEvents.map((event) => {
                      const clampedStart = event.start < dayStart ? dayStart : event.start;
                      const clampedEnd = event.end > dayEnd ? dayEnd : event.end;
                      const minutesFromStart = (clampedStart.getTime() - dayStart.getTime()) / 60000;
                      const minutesFromEnd = (clampedEnd.getTime() - dayStart.getTime()) / 60000;
                      const startSlot = Math.max(0, Math.floor(minutesFromStart / SLOT_MINUTES));
                      const endSlot = Math.min(
                        TOTAL_SLOTS,
                        Math.ceil(minutesFromEnd / SLOT_MINUTES)
                      );
                      if (endSlot <= startSlot) return null;
                      const isBlock = event.meta?.kind === "block";
                      const background = isBlock ? "#4B5563" : "#0B0D10";
                      const textColor = isBlock ? "#ffffff" : "#ffffff";

                      return (
                        <div
                          key={event.id}
                          className={clsx(
                            "flex items-center rounded-full px-3 text-[11px] font-medium shadow-sm",
                            isBlock && "border border-[#0B0D10]/10"
                          )}
                          style={{
                            gridColumnStart: startSlot + 1,
                            gridColumnEnd: endSlot + 1,
                            gridRowStart: 1,
                            gridRowEnd: 2,
                            zIndex: 4,
                            backgroundColor: background,
                            color: textColor,
                          }}
                          onClick={() => onBookingClick?.(event)}
                        >
                          <span className="truncate">{event.label}</span>
                        </div>
                      );
                    })}
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
