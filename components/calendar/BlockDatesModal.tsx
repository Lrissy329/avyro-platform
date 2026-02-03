import * as React from "react";

import type { DateRange } from "@/lib/calendarTypes";
import { formatRangeSummary } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BlockDatesPayload } from "@/lib/manualBlocks";

type BlockDatesModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingName: string;
  dateRange: DateRange | null;
  timezone?: string;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  disableConfirm?: boolean;
  onConfirm: (payload: BlockDatesPayload) => void;
};

const COLOR_OPTIONS = [
  { value: "#4B5563", label: "Neutral", className: "bg-[#4B5563]" },
  { value: "#0B0D10", label: "Deep", className: "bg-[#0B0D10]" },
];

export const BlockDatesModal: React.FC<BlockDatesModalProps> = ({
  open,
  onOpenChange,
  listingName,
  dateRange,
  timezone = "local time",
  isSubmitting,
  errorMessage,
  disableConfirm,
  onConfirm,
}) => {
  const [label, setLabel] = React.useState("Personal stay");
  const [notes, setNotes] = React.useState("");
  const [color, setColor] = React.useState<string | undefined>(COLOR_OPTIONS[0]?.value);

  React.useEffect(() => {
    if (open) {
      setLabel("Personal stay");
      setNotes("");
      setColor(COLOR_OPTIONS[0]?.value);
    }
  }, [open]);

  const handleConfirm = () => {
    if (!dateRange) return;
    onConfirm({
      label: label.trim() || "Blocked",
      notes: notes.trim() || undefined,
      color,
    });
  };

  const hasRange = !!(dateRange && dateRange.start && dateRange.end);
  const rangeLabel = hasRange
    ? formatRangeSummary(dateRange!.start, dateRange!.end)
    : "Select a listing and date range on the calendar";
  const listingLabel = listingName?.trim() || "this listing";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Block dates</DialogTitle>
          <DialogDescription>
            Reserve days on <span className="font-medium">{listingLabel}</span> for personal stays
            or maintenance. Guests will not be able to book these dates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <section className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
              Date range
            </Label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className={cn(!hasRange && "text-slate-400")}>{rangeLabel}</p>
              {hasRange && (
                <p className="mt-1 text-xs text-slate-500">
                  Times are interpreted in <span className="font-medium">{timezone}</span>.
                </p>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="block-label">Label</Label>
            <Input
              id="block-label"
              placeholder="Personal stay, Maintenance, Owner use..."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </section>

          <section className="space-y-2">
            <Label htmlFor="block-notes">Internal notes (optional)</Label>
            <Textarea
              id="block-notes"
              placeholder="Reason for blocking these dates (only visible to you)."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </section>

          <section className="space-y-2">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setColor(opt.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition hover:border-slate-400",
                    color === opt.value
                      ? "border-slate-900 bg-slate-900/5"
                      : "border-slate-200 bg-white"
                  )}
                >
                  <span
                    className={cn("h-4 w-4 rounded-full border border-slate-300", opt.className)}
                  />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          {errorMessage && (
            <div className="rounded-xl border border-[#E5484D]/30 bg-[#E5484D]/10 px-3 py-2 text-xs text-[#E5484D]">
              {errorMessage}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={disableConfirm || !hasRange || isSubmitting}
            onClick={handleConfirm}
          >
            {isSubmitting ? "Blocking..." : "Block dates"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type BlockTimesModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingName: string;
  startAt: Date | null;
  endAt: Date | null;
  timezone?: string;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  disableConfirm?: boolean;
  onConfirm: (payload: BlockDatesPayload) => void;
};

const formatTimeRange = (start: Date, end: Date, timeZone: string) => {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

  const startDate = dateFormatter.format(start);
  const endDate = dateFormatter.format(end);
  const startTime = timeFormatter.format(start);
  const endTime = timeFormatter.format(end);

  if (startDate === endDate) {
    return `${startDate} · ${startTime} – ${endTime}`;
  }

  return `${startDate} ${startTime} – ${endDate} ${endTime}`;
};

export const BlockTimesModal: React.FC<BlockTimesModalProps> = ({
  open,
  onOpenChange,
  listingName,
  startAt,
  endAt,
  timezone = "Europe/London",
  isSubmitting,
  errorMessage,
  disableConfirm,
  onConfirm,
}) => {
  const [label, setLabel] = React.useState("Personal stay");
  const [notes, setNotes] = React.useState("");
  const [color, setColor] = React.useState<string | undefined>(COLOR_OPTIONS[0]?.value);

  React.useEffect(() => {
    if (open) {
      setLabel("Personal stay");
      setNotes("");
      setColor(COLOR_OPTIONS[0]?.value);
    }
  }, [open]);

  const hasRange = Boolean(startAt && endAt);
  const rangeLabel = hasRange
    ? formatTimeRange(startAt as Date, endAt as Date, timezone)
    : "Select a listing and time range on the timeline";
  const listingLabel = listingName?.trim() || "this listing";

  const handleConfirm = () => {
    if (!startAt || !endAt) return;
    onConfirm({
      label: label.trim() || "Blocked",
      notes: notes.trim() || undefined,
      color,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Block time</DialogTitle>
          <DialogDescription>
            Reserve time on <span className="font-medium">{listingLabel}</span> for personal stays
            or maintenance. Guests will not be able to book these slots.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <section className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
              Time range
            </Label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className={cn(!hasRange && "text-slate-400")}>{rangeLabel}</p>
              {hasRange && (
                <p className="mt-1 text-xs text-slate-500">
                  Times are shown in <span className="font-medium">{timezone}</span>.
                </p>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="block-time-label">Label</Label>
            <Input
              id="block-time-label"
              placeholder="Personal stay, Maintenance, Owner use..."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </section>

          <section className="space-y-2">
            <Label htmlFor="block-time-notes">Internal notes (optional)</Label>
            <Textarea
              id="block-time-notes"
              placeholder="Reason for blocking this time (only visible to you)."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </section>

          <section className="space-y-2">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setColor(opt.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition hover:border-slate-400",
                    color === opt.value
                      ? "border-slate-900 bg-slate-900/5"
                      : "border-slate-200 bg-white"
                  )}
                >
                  <span
                    className={cn("h-4 w-4 rounded-full border border-slate-300", opt.className)}
                  />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          {errorMessage && (
            <div className="rounded-xl border border-[#E5484D]/30 bg-[#E5484D]/10 px-3 py-2 text-xs text-[#E5484D]">
              {errorMessage}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={disableConfirm || !hasRange || isSubmitting}
            onClick={handleConfirm}
          >
            {isSubmitting ? "Blocking..." : "Block time"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
