import type { SharedGroupOption } from "@/components/shared-stay/types";
import { SharedOccupancyPill } from "@/components/shared-stay/SharedOccupancyPill";

type SharedGroupOptionCardProps = {
  group: SharedGroupOption;
  selected?: boolean;
  onSelect?: (groupId: string) => void;
  perPersonWeeklyPricePence?: number | null;
};

const formatCurrency = (valuePence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valuePence / 100);

const formatRange = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return `${startDate} → ${endDate}`;
  }
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return `${fmt.format(start)} → ${fmt.format(end)}`;
};

export function SharedGroupOptionCard({
  group,
  selected,
  onSelect,
  perPersonWeeklyPricePence,
}: SharedGroupOptionCardProps) {
  const total = Math.max(1, Number(group.totalSpots || 1));
  const filled = Math.max(0, Math.min(total, Number(group.filledSpots || 0)));
  const canJoin = group.canJoin;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(group.id)}
      disabled={!canJoin}
      className={`w-full rounded-xl border p-3 text-left transition ${
        selected
          ? "border-slate-900 bg-slate-50"
          : "border-slate-200 bg-white hover:border-slate-300"
      } ${!canJoin ? "cursor-not-allowed opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{formatRange(group.startDate, group.endDate)}</p>
          <p className="mt-1 text-xs text-slate-600">Each guest books and pays individually</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
            canJoin ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {canJoin ? "Open" : "Full"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <SharedOccupancyPill filledSpots={filled} totalSpots={total} />
        {typeof perPersonWeeklyPricePence === "number" && perPersonWeeklyPricePence > 0 ? (
          <span className="text-sm font-semibold text-slate-900">
            {formatCurrency(perPersonWeeklyPricePence)} / week
          </span>
        ) : null}
      </div>
    </button>
  );
}
