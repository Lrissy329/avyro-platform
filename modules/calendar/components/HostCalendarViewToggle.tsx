import type { HostCalendarView } from "@/modules/calendar/types";

type HostCalendarViewToggleProps = {
  value: HostCalendarView;
  onChange: (next: HostCalendarView) => void;
};

const VIEWS: Array<{ id: HostCalendarView; label: string }> = [
  { id: "scheduler", label: "Scheduler" },
  { id: "hourly", label: "Hourly" },
  { id: "month", label: "Month" },
];

export function HostCalendarViewToggle({ value, onChange }: HostCalendarViewToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {VIEWS.map((view) => {
        const active = view.id === value;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onChange(view.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "bg-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
