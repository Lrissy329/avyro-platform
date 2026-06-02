type RollingAvailabilityState = "full" | "limited";

type RollingFlexPanelProps = {
  confirmedNights: number;
  requestedExtraNights: number;
  onRequestedExtraNightsChange: (value: number) => void;
  extraOptions: number[];
  protectableExtraNights: number;
  rollingWindowDays: number;
  availabilityState: RollingAvailabilityState;
  extensionUnitPriceLabel?: string | null;
};

const optionClass = (selected: boolean, disabled: boolean) =>
  `rounded-lg border px-3 py-2 text-sm font-semibold transition ${
    selected
      ? "border-slate-900 bg-slate-900 text-white"
      : disabled
      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
  }`;

export default function RollingFlexPanel({
  confirmedNights,
  requestedExtraNights,
  onRequestedExtraNightsChange,
  extraOptions,
  protectableExtraNights,
  rollingWindowDays,
  availabilityState,
  extensionUnitPriceLabel,
}: RollingFlexPanelProps) {
  const currentlyProtectableNights = Math.max(0, protectableExtraNights);
  const effectiveFlexibleExtensionNights = Math.max(
    0,
    Math.min(requestedExtraNights, currentlyProtectableNights)
  );

  return (
    <div className="space-y-3 rounded-lg bg-slate-50/70 px-3 py-2.5">
      <p className="text-sm font-semibold text-slate-900">Rolling flexible stay</p>
      <p className="mt-1 text-xs text-slate-600">
        Book the stay you need now. Extend if plans change.
      </p>
      <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600">
        Good for training blocks and uncertain schedules
      </span>

      <div>
        <label className="text-xs font-medium text-slate-500">
          Choose flexible extension
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {extraOptions.map((value) => {
            const selected = value === requestedExtraNights;
            const disabled = value > currentlyProtectableNights;
            return (
              <button
                key={`rolling-extra-${value}`}
                type="button"
                className={optionClass(selected, disabled)}
                onClick={() => onRequestedExtraNightsChange(value)}
                aria-pressed={selected}
                disabled={disabled}
                title={
                  disabled
                    ? `Currently only up to +${currentlyProtectableNights} night${
                        currentlyProtectableNights === 1 ? "" : "s"
                      } can be protected for these dates.`
                    : undefined
                }
              >
                +{value}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
        <p className="font-semibold text-slate-900">Rolling flex summary</p>
        <p className="mt-1">Confirmed stay: {confirmedNights} nights</p>
        <p>Flexible extension: up to {effectiveFlexibleExtensionNights} nights</p>
        <p>We automatically hold your next {rollingWindowDays} nights</p>
        <p>Extend your stay anytime before checkout</p>
        <p>Only pay for extra nights if you stay</p>
        {availabilityState === "limited" ? (
          <p className="mt-1 text-slate-500">
            Currently available extension may be limited for these dates
          </p>
        ) : null}
      </div>

      {extensionUnitPriceLabel ? (
        <p className="text-sm text-slate-700">
          Extra nights from <span className="font-medium text-slate-900">{extensionUnitPriceLabel}</span> / night
        </p>
      ) : null}
    </div>
  );
}
