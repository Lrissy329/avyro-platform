import { SharedOccupancyPill } from "@/components/shared-stay/SharedOccupancyPill";

type SharedStayHeaderProps = {
  perPersonWeeklyPricePence?: number | null;
  totalSpots: number;
  filledSpots: number;
  // False when more than one active date-range group exists for this
  // listing: showing one arbitrarily-selected group's occupancy as if it
  // were a single listing-wide figure is misleading in that case, so this
  // header falls back to a neutral, group-independent capacity label
  // instead. Per-group occupancy still renders correctly on each group's
  // own card further down in SharedStaySection.
  showOccupancy?: boolean;
};

const formatCurrency = (valuePence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valuePence / 100);

export function SharedStayHeader({
  perPersonWeeklyPricePence,
  totalSpots,
  filledSpots,
  showOccupancy = true,
}: SharedStayHeaderProps) {
  const safeTotal = Math.max(1, Math.round(totalSpots || 1));
  const safeFilled = Math.max(0, Math.min(safeTotal, Math.round(filledSpots || 0)));
  const remaining = Math.max(0, safeTotal - safeFilled);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">Shared stay</p>
        {showOccupancy ? (
          <SharedOccupancyPill filledSpots={safeFilled} totalSpots={safeTotal} />
        ) : (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {safeTotal} spaces per night
          </span>
        )}
      </div>
      <p className="text-xl font-semibold text-slate-900">
        {typeof perPersonWeeklyPricePence === "number" && perPersonWeeklyPricePence > 0
          ? `${formatCurrency(perPersonWeeklyPricePence)} per person / week`
          : "Shared weekly price set by host"}
      </p>
      <p className="text-sm text-slate-600">
        {showOccupancy
          ? `${safeTotal} spaces total · ${remaining === 0 ? "Full" : `${remaining} spaces available`}`
          : `${safeTotal} spaces per night · see individual dates below`}
      </p>
    </div>
  );
}
