type SharedCalendarBlockProps = {
  startDate: string;
  endDate: string;
  filledSpots: number;
  totalSpots: number;
  pendingSpots?: number;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
};

export function SharedCalendarBlock({
  startDate,
  endDate,
  filledSpots,
  totalSpots,
  pendingSpots = 0,
}: SharedCalendarBlockProps) {
  const safeTotal = Math.max(1, Math.round(Number(totalSpots) || 1));
  const safeFilled = Math.max(0, Math.round(Number(filledSpots) || 0));
  const safePending = Math.max(0, Math.round(Number(pendingSpots) || 0));
  const activeFilled = safeFilled + safePending;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">Shared stay</p>
      <p className="mt-1">{activeFilled}/{safeTotal} filled</p>
      <p className="mt-1 text-xs">{activeFilled} of {safeTotal} spots filled</p>
      {safePending > 0 ? <p className="mt-1 text-xs">{safePending} pending</p> : null}
      <p className="mt-1 text-xs">{formatDate(startDate)} → {formatDate(endDate)}</p>
    </div>
  );
}
