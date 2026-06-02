import { SharedOccupancyPill } from "@/components/shared-stay/SharedOccupancyPill";

type SharedStayHeaderProps = {
  perPersonWeeklyPricePence?: number | null;
  totalSpots: number;
  filledSpots: number;
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
}: SharedStayHeaderProps) {
  const safeTotal = Math.max(1, Math.round(totalSpots || 1));
  const safeFilled = Math.max(0, Math.min(safeTotal, Math.round(filledSpots || 0)));
  const remaining = Math.max(0, safeTotal - safeFilled);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">Shared stay</p>
        <SharedOccupancyPill filledSpots={safeFilled} totalSpots={safeTotal} />
      </div>
      <p className="text-xl font-semibold text-slate-900">
        {typeof perPersonWeeklyPricePence === "number" && perPersonWeeklyPricePence > 0
          ? `${formatCurrency(perPersonWeeklyPricePence)} per person / week`
          : "Shared weekly price set by host"}
      </p>
      <p className="text-sm text-slate-600">
        {safeTotal} spots total · {remaining === 0 ? "Full" : `${remaining} spots left`}
      </p>
    </div>
  );
}
