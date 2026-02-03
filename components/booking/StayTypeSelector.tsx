import type { BookingStayType } from "@/lib/calendarTypes";

const OPTIONS: Array<{
  value: BookingStayType;
  label: string;
  description: string;
}> = [
  { value: "nightly", label: "Nightly", description: "Standard overnight stay" },
  { value: "day_use", label: "Day use (6 hours)", description: "Short rest during the day" },
  { value: "crashpad", label: "Extended stay", description: "Longer-term stay booked nightly" },
];

type StayTypeSelectorProps = {
  value: BookingStayType;
  onChange: (value: BookingStayType) => void;
  className?: string;
};

export function StayTypeSelector({ value, onChange, className }: StayTypeSelectorProps) {
  return (
    <div className={`flex flex-wrap gap-3 ${className ?? ""}`}>
      {OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "w-full max-w-[200px] rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FEDD02]/60",
              active
                ? "border-[#FEDD02] bg-[#FEDD02]/20 text-slate-900 shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
            ].join(" ")}
          >
            <div className="font-semibold">{option.label}</div>
            <p className="mt-1 text-xs text-slate-500">{option.description}</p>
          </button>
        );
      })}
    </div>
  );
}
