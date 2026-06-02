type FlexTypeChoice = "extra_night" | "rolling";

type FlexTypeSelectorProps = {
  value: FlexTypeChoice;
  onChange: (next: FlexTypeChoice) => void;
  showExtraNight: boolean;
  showRolling: boolean;
};

const optionClass = (selected: boolean) =>
  `rounded-xl border px-3 py-3 text-left transition ${
    selected
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
  }`;

export default function FlexTypeSelector({
  value,
  onChange,
  showExtraNight,
  showRolling,
}: FlexTypeSelectorProps) {
  const optionCount = Number(showExtraNight) + Number(showRolling);
  if (optionCount === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500">
        Choose your flexibility
      </p>
      <div className={`grid gap-2 ${optionCount > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
        {showExtraNight ? (
          <button
            type="button"
            className={optionClass(value === "extra_night")}
            onClick={() => onChange("extra_night")}
            aria-pressed={value === "extra_night"}
          >
            <p className="text-sm font-semibold">Extra night</p>
            <p
              className={`mt-1 text-xs ${
                value === "extra_night" ? "text-white/80" : "text-slate-500"
              }`}
            >
              Best if you may need 1 more night
            </p>
          </button>
        ) : null}

        {showRolling ? (
          <button
            type="button"
            className={optionClass(value === "rolling")}
            onClick={() => onChange("rolling")}
            aria-pressed={value === "rolling"}
          >
            <p className="text-sm font-semibold">Rolling flex</p>
            <p
              className={`mt-1 text-xs ${
                value === "rolling" ? "text-white/80" : "text-slate-500"
              }`}
            >
              Best for training blocks and uncertain schedules
            </p>
          </button>
        ) : null}
      </div>
    </div>
  );
}
