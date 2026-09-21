import { SharedOccupancyPill } from "@/components/shared-stay/SharedOccupancyPill";
import type {
  SharedDateRange,
  SharedGroupOption,
  SharedGroupOptionsResponse,
} from "@/components/shared-stay/types";

type SharedStaySectionProps = {
  isSharedStay: boolean;
  // Kept so existing callers still type-check; the simplified section no longer needs them.
  perPersonWeeklyPricePence?: number | null;
  minWeeks?: number | null;
  maxWeeks?: number | null;
  showCreationFlow?: boolean;
  onJoin?: () => void;
  onStartGroup?: () => void;
  joinDisabled?: boolean;
  startDisabled?: boolean;
  joinLoading?: boolean;
  startLoading?: boolean;
  totalSpots?: number | null;
  filledSpots?: number | null;
  joinMode?: "open" | "approval" | string | null;
  selectedDateRange?: SharedDateRange;
  sharedOptionsData?: SharedGroupOptionsResponse | null;
  loading?: boolean;
  error?: string | null;
  onQuickJoinGroup?: (group: SharedGroupOption) => void;
};

// More than this and the list stops being scannable; the date picker below covers the rest.
const MAX_LISTED_GROUPS = 3;

const formatCalendarRange = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return `${startDate} → ${endDate}`;
  }
  const formatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

export function SharedStaySection({
  isSharedStay,
  totalSpots,
  filledSpots,
  joinMode,
  selectedDateRange,
  sharedOptionsData,
  loading,
  error,
  onQuickJoinGroup,
}: SharedStaySectionProps) {
  if (!isSharedStay) return null;

  const groups = (sharedOptionsData?.groups ?? []).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  const joinableGroups = groups.filter((group) => group.canJoin);
  const selectedGroup =
    groups.find((group) => group.id === sharedOptionsData?.suggestedJoinGroupId) ??
    joinableGroups[0] ??
    groups[0] ??
    null;

  const safeTotalSpots = selectedGroup?.totalSpots ?? Math.max(1, Math.round(Number(totalSpots ?? 1)) || 1);
  const safeFilledSpots =
    selectedGroup?.filledSpots ?? Math.max(0, Math.round(Number(filledSpots ?? 0)) || 0);
  const normalizedJoinMode =
    String(sharedOptionsData?.joinMode ?? joinMode ?? "open").toLowerCase() === "approval"
      ? "approval"
      : "open";

  // More than one active group means one group's occupancy would be shown as a listing-wide figure,
  // which would be misleading, so fall back to a neutral capacity label.
  const hasMultipleGroups = groups.length > 1;

  const hasDateRange = Boolean(selectedDateRange?.checkIn && selectedDateRange?.checkOut);
  const showActiveSharedStays = !hasDateRange && joinableGroups.length > 0;
  const hasRestrictionReason = Boolean(sharedOptionsData?.reason);
  const isFullState =
    hasDateRange && !hasRestrictionReason && groups.length > 0 && joinableGroups.length === 0;

  // One short status line, in priority order, instead of a card per state.
  let status: { text: string; tone: "muted" | "error" } | null = null;
  if (error) status = { text: error, tone: "error" };
  else if (loading) status = { text: "Checking availability…", tone: "muted" };
  else if (normalizedJoinMode === "approval")
    status = { text: "This shared stay currently requires host approval to join.", tone: "muted" };
  else if (isFullState)
    status = { text: "This stay is full for those dates. Try other dates.", tone: "muted" };
  else if (hasDateRange && hasRestrictionReason && sharedOptionsData?.reason)
    status = { text: sharedOptionsData.reason, tone: "muted" };
  else if (groups.length === 0)
    status = { text: "Nobody has booked yet. Book first and others can join automatically.", tone: "muted" };

  const listed = joinableGroups.slice(0, MAX_LISTED_GROUPS);
  const hiddenCount = joinableGroups.length - listed.length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {!hasMultipleGroups ? (
          <SharedOccupancyPill filledSpots={safeFilledSpots} totalSpots={Math.max(1, safeTotalSpots)} />
        ) : (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {Math.max(1, safeTotalSpots)} spaces per night
          </span>
        )}
        {status ? (
          <p className={`text-sm ${status.tone === "error" ? "text-rose-600" : "text-slate-600"}`}>
            {status.text}
          </p>
        ) : null}
      </div>

      {showActiveSharedStays ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-900">Join a stay that&apos;s already booked</p>
          <ul className="space-y-2">
            {listed.map((group) => {
              const remaining = Math.max(0, group.spotsRemaining);
              return (
                <li
                  key={group.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {formatCalendarRange(group.startDate, group.endDate)}
                    </p>
                    <p className="text-xs text-slate-600">
                      {remaining} space{remaining === 1 ? "" : "s"} left
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onQuickJoinGroup?.(group)}
                    className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Join
                  </button>
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 ? (
            <p className="text-xs text-slate-500">
              +{hiddenCount} more. Choose your dates below to check them.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
