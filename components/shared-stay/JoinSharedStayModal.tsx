import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SharedGroupOptionCard } from "@/components/shared-stay/SharedGroupOptionCard";
import { SharedPricingSummary } from "@/components/shared-stay/SharedPricingSummary";
import type { SharedGroupOption } from "@/components/shared-stay/types";

type JoinSharedStayModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDateRange?: { checkIn?: string | null; checkOut?: string | null };
  joinableGroups: SharedGroupOption[];
  hasAnyGroups?: boolean;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  perPersonWeeklyPricePence?: number | null;
  selectedWeeks: number;
  loading?: boolean;
  error?: string | null;
  onCheckout: () => void;
  onStartGroup?: () => void;
};

export function JoinSharedStayModal({
  open,
  onOpenChange,
  selectedDateRange,
  joinableGroups,
  hasAnyGroups = false,
  selectedGroupId,
  onSelectGroup,
  perPersonWeeklyPricePence,
  selectedWeeks,
  loading,
  error,
  onCheckout,
  onStartGroup,
}: JoinSharedStayModalProps) {
  const selectedGroup =
    joinableGroups.find((group) => group.id === selectedGroupId) ?? joinableGroups[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Join this crew stay</DialogTitle>
          <DialogDescription>
            Dates: {selectedDateRange?.checkIn ?? "—"} → {selectedDateRange?.checkOut ?? "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {selectedGroup ? (
            <p className="text-sm text-slate-700">
              {selectedGroup.filledSpots} of {selectedGroup.totalSpots} spots filled
            </p>
          ) : null}

          {joinableGroups.length > 0 ? (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {joinableGroups.map((group) => (
                <SharedGroupOptionCard
                  key={group.id}
                  group={group}
                  selected={selectedGroupId === group.id}
                  onSelect={onSelectGroup}
                  perPersonWeeklyPricePence={perPersonWeeklyPricePence}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">
                {hasAnyGroups ? "This stay is full" : "No crew booked yet"}
              </p>
              <p className="mt-1">
                {hasAnyGroups
                  ? "Check other dates or start a new group."
                  : "Be the first to start this stay. Others can join automatically."}
              </p>
              {onStartGroup ? (
                <button
                  type="button"
                  className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  onClick={onStartGroup}
                >
                  Start a new group
                </button>
              ) : null}
            </div>
          )}

          <p className="text-sm text-slate-700">Each guest books and pays individually</p>

          <SharedPricingSummary
            perPersonWeeklyPricePence={perPersonWeeklyPricePence}
            selectedWeeks={selectedWeeks}
          />
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          {joinableGroups.length > 0 ? (
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={!selectedGroupId || loading}
              onClick={onCheckout}
            >
              {loading ? "Redirecting…" : "Join and pay"}
            </button>
          ) : onStartGroup ? (
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={onStartGroup}
            >
              Start a new group
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
