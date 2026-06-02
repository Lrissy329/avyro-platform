import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SharedPricingSummary } from "@/components/shared-stay/SharedPricingSummary";
import { SharedWeekSelector } from "@/components/shared-stay/SharedWeekSelector";
import type { SharedDateRange } from "@/components/shared-stay/types";

type StartSharedGroupModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  perPersonWeeklyPricePence?: number | null;
  minWeeks: number;
  maxWeeks: number;
  selectedDateRange?: SharedDateRange;
  selectedWeeks: number;
  onWeeksChange: (weeks: number) => void;
  loading?: boolean;
  error?: string | null;
  onCheckout: () => void;
};

const addDaysToIsoDate = (value: string, days: number) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const result = new Date(year, month - 1, day + days);
  if (!Number.isFinite(result.getTime())) return null;
  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, "0");
  const dd = String(result.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export function StartSharedGroupModal({
  open,
  onOpenChange,
  perPersonWeeklyPricePence,
  minWeeks,
  maxWeeks,
  selectedDateRange,
  selectedWeeks,
  onWeeksChange,
  loading,
  error,
  onCheckout,
}: StartSharedGroupModalProps) {
  const checkIn = selectedDateRange?.checkIn ?? null;
  const computedCheckOut = checkIn ? addDaysToIsoDate(checkIn, selectedWeeks * 7) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Start a new crew stay</DialogTitle>
          <DialogDescription>
            Select your weeks. You’ll secure the first spot and others can join automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <SharedWeekSelector
            minWeeks={minWeeks}
            maxWeeks={maxWeeks}
            selectedStartDate={checkIn}
            selectedWeeks={selectedWeeks}
            onChange={onWeeksChange}
          />

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Selected stay window</p>
            <p className="mt-1">
              {checkIn && computedCheckOut
                ? `${checkIn} → ${computedCheckOut}`
                : "Choose your dates in the booking widget first."}
            </p>
            <p className="mt-2 text-xs">Each guest books and pays individually.</p>
          </div>

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
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={loading || !checkIn || !computedCheckOut}
            onClick={onCheckout}
          >
            {loading ? "Redirecting…" : "Start group and pay"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
