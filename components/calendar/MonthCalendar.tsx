import { useMemo } from "react";
import clsx from "clsx";

import type { LinearCalendarListing } from "@/components/calendar/LinearCalendar";
import { addDays, formatLocalDate, startOfDay, startOfWeek } from "@/lib/dateUtils";

export type MonthDayState = "booked" | "manual" | "external";

type MonthCalendarProps = {
  listings: LinearCalendarListing[];
  monthStart: Date;
  dayStates: Record<string, Record<string, MonthDayState>>;
  hourlyIndicators?: Record<string, Record<string, boolean>>;
  onDayClick?: (date: Date, listingId: string) => void;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ROW_HEIGHT = 30;

export function MonthCalendar({
  listings,
  monthStart,
  dayStates,
  hourlyIndicators,
  onDayClick,
}: MonthCalendarProps) {
  const todayIso = formatLocalDate(startOfDay(new Date()));
  const gridStart = useMemo(() => startOfWeek(monthStart), [monthStart]);
  const days = useMemo(
    () => Array.from({ length: 42 }, (_, idx) => addDays(gridStart, idx)),
    [gridStart]
  );

  const monthKey = useMemo(
    () =>
      monthStart.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [monthStart]
  );

  return (
    <div className="min-h-[70vh] rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
      <div className="flex">
        <div className="sticky left-0 z-20 w-44 shrink-0 border-r border-slate-200 bg-white">
          <div
            className="flex items-center border-b-2 border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700"
            style={{ height: `${ROW_HEIGHT}px` }}
          >
            {monthKey}
          </div>
          {listings.map((listing, index) => (
            <div
              key={listing.id}
              className={clsx(
                "flex items-center border-b-2 border-slate-200 bg-white px-3 text-xs text-slate-500",
                index % 2 === 1 && "bg-slate-50/60"
              )}
              style={{ height: `${ROW_HEIGHT * 6}px` }}
            >
              <span className="truncate">{listing.name}</span>
            </div>
          ))}
        </div>

        <div className="flex-1">
          <div
            className="grid border-b-2 border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-700"
            style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", height: `${ROW_HEIGHT}px` }}
          >
            {WEEKDAYS.map((day) => (
              <div key={day} className="flex items-center justify-center border-r border-slate-200">
                {day}
              </div>
            ))}
          </div>

          {listings.map((listing, listingIndex) => (
            <div
              key={listing.id}
              className={clsx("border-b-2 border-slate-200 bg-white", listingIndex % 2 === 1 && "bg-slate-50/40")}
              style={{ height: `${ROW_HEIGHT * 6}px` }}
            >
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  gridTemplateRows: `repeat(6, ${ROW_HEIGHT}px)`,
                  height: `${ROW_HEIGHT * 6}px`,
                }}
              >
                {days.map((day) => {
                  const dayIso = formatLocalDate(day);
                  const isInMonth = day.getMonth() === monthStart.getMonth();
                  const state = dayStates?.[listing.id]?.[dayIso];
                  const hasHourly = hourlyIndicators?.[listing.id]?.[dayIso];
                  const isToday = dayIso === todayIso;

                  const stateClass =
                    state === "booked"
                      ? "bg-[#14FF62]/15 text-[#0B0D10]"
                      : state === "manual"
                      ? "bg-slate-100 text-slate-600"
                      : state === "external"
                      ? "bg-slate-200 text-slate-700"
                      : "bg-white text-slate-600";

                  return (
                    <button
                      key={`${listing.id}-${day.getTime()}`}
                      type="button"
                      onClick={() => onDayClick?.(day, listing.id)}
                      className={clsx(
                        "relative flex h-full w-full flex-col items-end justify-start border-b border-r border-slate-200 px-2 py-1 text-[11px] leading-tight",
                        stateClass,
                        !isInMonth && "text-slate-300",
                        isToday && "bg-yellow-50/50 ring-1 ring-yellow-200/60"
                      )}
                      style={{ minHeight: `${ROW_HEIGHT}px` }}
                    >
                      <span
                        className={clsx(
                          "text-[10px] font-mono tabular-nums",
                          !isInMonth && "text-slate-300"
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {hasHourly && (
                        <span className="absolute left-2 bottom-2 h-1.5 w-6 rounded-full bg-slate-400/70" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
