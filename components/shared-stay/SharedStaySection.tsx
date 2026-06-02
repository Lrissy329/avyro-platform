import { SharedStayHeader } from "@/components/shared-stay/SharedStayHeader";
import { SharedTrustRow } from "@/components/shared-stay/SharedTrustRow";
import { JoinSharedStayButton } from "@/components/shared-stay/JoinSharedStayButton";
import { StartSharedGroupButton } from "@/components/shared-stay/StartSharedGroupButton";
import type { SharedDateRange, SharedGroupOptionsResponse } from "@/components/shared-stay/types";

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
  onJoin: () => void;
  onStartGroup: () => void;
  joinDisabled?: boolean;
  startDisabled?: boolean;
  joinLoading?: boolean;
  startLoading?: boolean;
};

const formatDateRange = (range?: SharedDateRange) => {
  if (!range?.checkIn || !range?.checkOut) return "Choose dates to see shared options.";
  return `Week: ${range.checkIn} → ${range.checkOut}`;
};

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
  onJoin,
  onStartGroup,
  joinDisabled,
  startDisabled,
  joinLoading,
  startLoading,
}: SharedStaySectionProps) {
  if (!isSharedStay) return null;

  const groups = sharedOptionsData?.groups ?? [];
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

      <SharedTrustRow professionalsOnly individualBooking noSharedPayment />

      <div className="space-y-1 text-xs text-slate-600">
        <p>{safeMinWeeks}–{safeMaxWeeks} week stays</p>
        <p>{formatDateRange(selectedDateRange)}</p>
        {groups.length > 0 ? (
          <p>
            {safeFilledSpots} of {safeTotalSpots} spots filled · {spotsLeft} spots left
          </p>
        ) : null}
        {isEmptyState ? (
          <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-700">
            <p className="font-semibold text-slate-900">No crew booked yet</p>
            <p className="mt-1 text-xs">Be the first to start this stay. Others can join automatically.</p>
          </div>
        ) : null}
        {isFullState ? (
          <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-700">
            <p className="font-semibold text-slate-900">This stay is full</p>
            <p className="mt-1 text-xs">Check other dates or start a new group.</p>
          </div>
        ) : null}
        {sharedOptionsData?.reason && !isEmptyState && !isFullState ? (
          <p>{sharedOptionsData.reason}</p>
        ) : null}
        {normalizedJoinMode === "approval" ? (
          <p>Approval-based joining will be supported in a later release.</p>
        ) : null}
        {loading ? <p>Checking shared group options…</p> : null}
        {error ? <p className="text-rose-600">{error}</p> : null}
      </div>

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
    </section>
  );
}
