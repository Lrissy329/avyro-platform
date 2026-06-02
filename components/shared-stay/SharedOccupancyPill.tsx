type SharedOccupancyPillProps = {
  filledSpots: number;
  totalSpots: number;
};

export function SharedOccupancyPill({
  filledSpots,
  totalSpots,
}: SharedOccupancyPillProps) {
  const safeTotal = Math.max(1, Math.round(totalSpots || 1));
  const safeFilled = Math.max(0, Math.min(safeTotal, Math.round(filledSpots || 0)));
  const remaining = Math.max(0, safeTotal - safeFilled);

  const state =
    remaining === 0 ? "full" : remaining <= 1 ? "nearly_full" : "open";
  const styles =
    state === "full"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : state === "nearly_full"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${styles}`}
    >
      {safeFilled} of {safeTotal} spots filled
    </span>
  );
}

