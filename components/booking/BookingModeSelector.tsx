type BookingTypeChoice = "fixed" | "flexible";

type BookingModeSelectorProps = {
  value: BookingTypeChoice;
  supportsFlex: boolean;
  showRollingBadge?: boolean;
  onChange: (mode: BookingTypeChoice) => void;
};

const optionClass = (selected: boolean) =>
  `rounded-2xl border px-4 py-3 text-left transition ${
    selected
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
  }`;

export default function BookingModeSelector({
  value,
  supportsFlex,
  showRollingBadge = false,
  onChange,
}: BookingModeSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">Choose how you want to book</p>
        {showRollingBadge && supportsFlex ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
            Good for uncertain schedules
          </span>
        ) : null}
      </div>
      <div className={`grid gap-2 ${supportsFlex ? "sm:grid-cols-2" : "grid-cols-1"}`}>
        <button
          type="button"
          className={optionClass(value === "fixed")}
          onClick={() => onChange("fixed")}
          aria-pressed={value === "fixed"}
        >
          <p className="text-sm font-semibold">Fixed stay</p>
          <p className={`mt-1 text-xs ${value === "fixed" ? "text-white/80" : "text-slate-500"}`}>
            Choose fixed dates for a standard booking.
          </p>
        </button>

        {supportsFlex ? (
          <button
            type="button"
            className={optionClass(value === "flexible")}
            onClick={() => onChange("flexible")}
            aria-pressed={value === "flexible"}
          >
            <p className="text-sm font-semibold">Flexible stay</p>
            <p
              className={`mt-1 text-xs ${
                value === "flexible" ? "text-white/80" : "text-slate-500"
              }`}
            >
              Stay longer if plans change — no rebooking needed.
            </p>
          </button>
        ) : null}
      </div>
    </div>
  );
}
