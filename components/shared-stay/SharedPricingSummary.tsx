type SharedPricingSummaryProps = {
  perPersonWeeklyPricePence?: number | null;
  selectedWeeks: number;
  totalDuePence?: number | null;
};

const formatCurrency = (valuePence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valuePence / 100);

export function SharedPricingSummary({
  perPersonWeeklyPricePence,
  selectedWeeks,
  totalDuePence,
}: SharedPricingSummaryProps) {
  const safeWeeks = Math.max(1, Math.round(selectedWeeks || 1));
  const computedTotal =
    typeof totalDuePence === "number"
      ? Math.max(0, Math.round(totalDuePence))
      : typeof perPersonWeeklyPricePence === "number"
      ? Math.max(0, Math.round(perPersonWeeklyPricePence) * safeWeeks)
      : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-semibold text-slate-900">
        {typeof perPersonWeeklyPricePence === "number" && perPersonWeeklyPricePence > 0
          ? `${formatCurrency(perPersonWeeklyPricePence)} per person / week`
          : "Weekly price set by host"}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        {safeWeeks} week{safeWeeks === 1 ? "" : "s"} selected
      </p>

      <div className="mt-3 border-t border-slate-200 pt-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Total due today</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          {computedTotal != null ? formatCurrency(computedTotal) : "—"}
        </p>
      </div>

      <p className="mt-2 text-xs text-slate-600">Each guest books and pays individually</p>
    </div>
  );
}
