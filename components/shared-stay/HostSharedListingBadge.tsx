type HostSharedListingBadgeProps = {
  isSharedStay?: boolean | null;
  totalSpots?: number | null;
  className?: string;
};

export function HostSharedListingBadge({
  isSharedStay,
  totalSpots,
  className = "",
}: HostSharedListingBadgeProps) {
  if (!isSharedStay) return null;

  const safeSpots = Math.max(1, Math.round(Number(totalSpots ?? 1)) || 1);

  return (
    <span
      className={`inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ${className}`}
    >
      Shared stay · {safeSpots} spot{safeSpots === 1 ? "" : "s"}
    </span>
  );
}
