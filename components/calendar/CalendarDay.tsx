import clsx from "clsx";
import { DayState } from "@/lib/calendarTypes";

type CalendarDayProps = {
  date: Date;
  isCurrentMonth: boolean;
  isToday?: boolean;
  state: DayState;
  isInRange?: boolean;
  isRangeStart?: boolean;
  isRangeEnd?: boolean;
  onClick?: () => void;
};

const stateLabelDotClass: Record<DayState, string | null> = {
  free: null,
  direct_confirmed: "bg-[#0B0D10]",
  direct_pending: "border border-[#0B0D10]",
  blocked: "bg-[#4B5563]",
  external: "bg-[#4B5563]",
  conflict: "bg-[#E5484D]",
};

export function CalendarDay({
  date,
  isCurrentMonth,
  isToday,
  state,
  isInRange,
  isRangeStart,
  isRangeEnd,
  onClick,
}: CalendarDayProps) {
  const dayNumber = date.getDate();
  const isRangeEdge = Boolean(isRangeStart || isRangeEnd);

  const baseCircleClasses = clsx(
    "inline-flex h-8 w-8 items-center justify-center rounded-full text-xs md:text-sm transition-colors bg-white font-mono tabular-nums",
    isCurrentMonth ? "text-slate-800" : "text-slate-300",
    isToday && "border border-slate-900",
    isInRange && !isRangeEdge && "bg-slate-100 text-slate-900",
    isRangeEdge && "bg-slate-900 text-white border border-slate-900"
  );

  const dotClass = stateLabelDotClass[state];

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#FEDD02]/60"
    >
      <span className={baseCircleClasses}>{dayNumber}</span>

      {dotClass && (
        <span
          className={clsx(
            "absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full",
            state === "direct_pending" ? "border border-[#0B0D10]" : dotClass
          )}
        />
      )}

      {state === "conflict" && (
        <span className="absolute right-0 top-0 flex h-3 w-3 items-center justify-center rounded-full bg-[#E5484D] text-[8px] font-semibold text-white">
          !
        </span>
      )}
    </button>
  );
}
