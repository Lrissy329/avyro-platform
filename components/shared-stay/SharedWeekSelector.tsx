type SharedWeekSelectorProps = {
  minWeeks: number;
  maxWeeks: number;
  selectedStartDate?: string | null;
  selectedWeeks: number;
  onChange: (weeks: number) => void;
};

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
};

export function SharedWeekSelector({
  minWeeks,
  maxWeeks,
  selectedStartDate,
  selectedWeeks,
  onChange,
}: SharedWeekSelectorProps) {
  const safeMin = Math.max(1, Math.round(minWeeks || 1));
  const safeMax = Math.max(safeMin, Math.round(maxWeeks || safeMin));
  const options = Array.from({ length: safeMax - safeMin + 1 }, (_, idx) => safeMin + idx);
  const selectedStart = formatDate(selectedStartDate);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Week range</p>
      <div className="flex flex-wrap gap-2">
        {options.map((weeks) => (
          <button
            key={weeks}
            type="button"
            onClick={() => onChange(weeks)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              selectedWeeks === weeks
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
          >
            {weeks} week{weeks === 1 ? "" : "s"}
          </button>
        ))}
      </div>
      {selectedStart ? (
        <p className="text-xs text-slate-500">Start: {selectedStart}</p>
      ) : null}
    </div>
  );
}

