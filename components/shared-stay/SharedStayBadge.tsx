type SharedStayBadgeProps = {
  isSharedStay: boolean;
  perPersonWeeklyPrice?: number | null;
  spotsRemaining?: number | null;
  totalSpots?: number | null;
  className?: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export function SharedStayBadge({
  isSharedStay,
  perPersonWeeklyPrice,
  spotsRemaining,
  className = "",
}: SharedStayBadgeProps) {
  if (!isSharedStay) return null;

  const hasSpots = typeof spotsRemaining === "number" && spotsRemaining >= 0;
  const safeSpots = hasSpots ? Math.max(0, Math.round(Number(spotsRemaining) || 0)) : null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700">
        Shared stay
      </span>
      {typeof perPersonWeeklyPrice === "number" && perPersonWeeklyPrice > 0 ? (
        <span className="inline-flex rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-900">
          {formatCurrency(perPersonWeeklyPrice)} / week
        </span>
      ) : null}
      {safeSpots != null ? (
        <span className="inline-flex rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
          {safeSpots === 0
            ? "Full"
            : `${safeSpots} spot${safeSpots === 1 ? "" : "s"} left`}
        </span>
      ) : null}
    </div>
  );
}
