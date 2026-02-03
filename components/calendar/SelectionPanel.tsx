import { DateRange, CalendarEvent } from "@/lib/calendarTypes";

type SelectionPanelProps = {
  selectedRange: DateRange | null;
  eventsInRange: CalendarEvent[];
  onBlock: () => void;
  onUnblock: () => void;
  isBlocking?: boolean;
  blockLabel?: string;
  blockColor?: string;
};

export function SelectionPanel({
  selectedRange,
  eventsInRange,
  onBlock,
  onUnblock,
  isBlocking = false,
  blockLabel,
  blockColor,
}: SelectionPanelProps) {
  if (!selectedRange) return null;

  const hasConflict = eventsInRange.length > 1;
  const label = `${selectedRange.start.toDateString()} – ${selectedRange.end.toDateString()}`;

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
      {hasConflict && (
        <div className="mb-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          These dates already contain bookings or external holds. New direct bookings are disabled to prevent conflicts.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Selected dates</p>
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          {(blockLabel || blockColor) && (
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              {blockColor && <span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: blockColor }} />}
              <span>{blockLabel || "Manual block"}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBlock}
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={hasConflict || isBlocking}
          >
            {isBlocking ? "Saving…" : "Block dates"}
          </button>
          <button
            type="button"
            onClick={onUnblock}
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Unblock dates
          </button>
        </div>
      </div>
    </section>
  );
}
