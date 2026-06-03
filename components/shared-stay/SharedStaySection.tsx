import { SharedStayHeader } from "@/components/shared-stay/SharedStayHeader";
import { SharedTrustRow } from "@/components/shared-stay/SharedTrustRow";
import { JoinSharedStayButton } from "@/components/shared-stay/JoinSharedStayButton";
import { StartSharedGroupButton } from "@/components/shared-stay/StartSharedGroupButton";
import type {
  SharedDateRange,
  SharedGroupOption,
  SharedGroupOptionsResponse,
} from "@/components/shared-stay/types";

type SharedStaySectionProps = {
  isSharedStay: boolean;
  perPersonWeeklyPricePence?: number | null;
  totalSpots?: number | null;
  filledSpots?: number | null;
  minWeeks?: number | null;
  maxWeeks?: number | null;
  joinMode?: "open" | "approval" | string | null;
  selectedDateRange?: SharedDateRange;
  sharedOptionsData?: SharedGroupOptionsResponse | null;
  loading?: boolean;
  error?: string | null;
  showCreationFlow?: boolean;
  onJoin: () => void;
  onQuickJoinGroup?: (group: SharedGroupOption) => void;
  onStartGroup: () => void;
  joinDisabled?: boolean;
  startDisabled?: boolean;
  joinLoading?: boolean;
  startLoading?: boolean;
};

const formatDateRange = (range?: SharedDateRange) => {
  if (!range?.checkIn || !range?.checkOut) return "Choose full-week dates to check a specific stay.";
  return `Week: ${range.checkIn} → ${range.checkOut}`;
};

const formatCalendarRange = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return `${startDate} → ${endDate}`;
  }
  const formatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

const formatCurrency = (valuePence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valuePence / 100);

export function SharedStaySection({
  isSharedStay,
  perPersonWeeklyPricePence,
  totalSpots,
  filledSpots,
  minWeeks,
  maxWeeks,
  joinMode,
  selectedDateRange,
  sharedOptionsData,
  loading,
  error,
  showCreationFlow = false,
  onJoin,
  onQuickJoinGroup,
  onStartGroup,
  joinDisabled,
  startDisabled,
  joinLoading,
  startLoading,
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
  const spotsLeft = Math.max(0, safeTotalSpots - safeFilledSpots);
  const safeMinWeeks = Math.max(1, Math.round(Number(sharedOptionsData?.minWeeks ?? minWeeks ?? 1)) || 1);
  const safeMaxWeeks = Math.max(
    safeMinWeeks,
    Math.round(Number(sharedOptionsData?.maxWeeks ?? maxWeeks ?? safeMinWeeks)) || safeMinWeeks
  );
  const normalizedJoinMode =
    String(sharedOptionsData?.joinMode ?? joinMode ?? "open").toLowerCase() === "approval"
      ? "approval"
      : "open";

  const hasDateRange = Boolean(selectedDateRange?.checkIn && selectedDateRange?.checkOut);
  const showActiveSharedStays = !hasDateRange && joinableGroups.length > 0;
  const hasRestrictionReason = Boolean(sharedOptionsData?.reason);
  const isFullState =
    hasDateRange && !hasRestrictionReason && groups.length > 0 && joinableGroups.length === 0;
  const isEmptyState = hasDateRange && !hasRestrictionReason && groups.length === 0;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
      <SharedStayHeader
        perPersonWeeklyPricePence={sharedOptionsData?.perPersonWeeklyPricePence ?? perPersonWeeklyPricePence}
        totalSpots={safeTotalSpots}
        filledSpots={safeFilledSpots}
      />

      <p className="text-sm text-slate-700">Stay with other professionals working nearby.</p>
      <p className="text-sm text-slate-600">
        Book your individual spot. Other professionals may continue joining this stay until all spots are filled.
      </p>

      <SharedTrustRow professionalsOnly individualBooking noSharedPayment />

      {showActiveSharedStays ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Active shared stays</p>
            <p className="mt-1 text-xs text-slate-600">Join an existing shared stay without starting a new group.</p>
          </div>
          <div className="space-y-2.5">
            {joinableGroups.map((group) => {
              const remaining = Math.max(0, group.spotsRemaining);
              return (
                <div
                  key={group.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatCalendarRange(group.startDate, group.endDate)}
                      </p>
                      <p className="text-xs text-slate-600">
                        {group.filledSpots} of {group.totalSpots} spots filled
                      </p>
                      <p className="text-xs text-slate-600">
                        {remaining} spot{remaining === 1 ? "" : "s"} remaining
                      </p>
                      {typeof perPersonWeeklyPricePence === "number" && perPersonWeeklyPricePence > 0 ? (
                        <p className="text-sm font-semibold text-slate-900">
                          {formatCurrency(perPersonWeeklyPricePence)} / person / week
                        </p>
                      ) : null}
                      <p className="pt-1 text-xs text-slate-500">
                        Join other professionals already staying.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onQuickJoinGroup?.(group)}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Join this stay
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-sm text-slate-600">Need different dates?</span>
            <StartSharedGroupButton
              onClick={onStartGroup}
              disabled={normalizedJoinMode === "approval"}
              loading={false}
            />
          </div>
        </div>
      ) : null}

      {showCreationFlow || (!showActiveSharedStays && !hasDateRange) ? (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">Start a new shared stay</p>
            <p className="text-xs text-slate-600">
              Choose your dates in full weeks if you need a different stay window.
            </p>
          </div>
          <div className="space-y-1 text-xs text-slate-600">
            <p>{safeMinWeeks}–{safeMaxWeeks} week stays</p>
            <p>{formatDateRange(selectedDateRange)}</p>
            {hasDateRange && groups.length > 0 ? (
              <p>
                {safeFilledSpots} of {safeTotalSpots} spots filled · {spotsLeft} spots left
              </p>
            ) : null}
            {isEmptyState ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                <p className="font-semibold text-slate-900">No crew booked yet</p>
                <p className="mt-1 text-xs">Be the first to start this stay. Others can join automatically.</p>
              </div>
            ) : null}
            {isFullState ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                <p className="font-semibold text-slate-900">This stay is full</p>
                <p className="mt-1 text-xs">Check other dates or start a new shared stay.</p>
              </div>
            ) : null}
            {sharedOptionsData?.reason && !isEmptyState && !isFullState ? (
              <p>{sharedOptionsData.reason}</p>
            ) : null}
            {normalizedJoinMode === "approval" ? (
              <p>Approval-based joining will be supported in a later release.</p>
            ) : null}
            {loading ? <p>Checking shared stay options…</p> : null}
            {error ? <p className="text-rose-600">{error}</p> : null}
          </div>
        </div>
      ) : null}

      {!showActiveSharedStays && showCreationFlow ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {joinableGroups.length > 0 ? (
            <JoinSharedStayButton onClick={onJoin} disabled={joinDisabled} loading={joinLoading} />
          ) : null}
          <StartSharedGroupButton
            onClick={onStartGroup}
            disabled={startDisabled || normalizedJoinMode === "approval"}
            loading={startLoading}
          />
        </div>
      ) : null}
    </section>
  );
}
