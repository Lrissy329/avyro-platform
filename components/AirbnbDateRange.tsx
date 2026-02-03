"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isBefore,
  startOfDay,
} from "date-fns";
import { DateRange, DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

type Props = {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  minNights?: number;
  isDateBlocked?: (date: Date) => boolean;
  numberOfMonths?: 1 | 2;
  disabled?: boolean;
  label?: string;
  className?: string;
  showShortcuts?: boolean;
};

export default function AirbnbDateRange({
  value,
  onChange,
  minNights = 0,
  isDateBlocked,
  numberOfMonths = 2,
  disabled,
  label = "Add dates",
  className,
  showShortcuts = true,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [range, setRange] = React.useState<DateRange | undefined>(value);
  const [hoverDate, setHoverDate] = React.useState<Date | undefined>();

  React.useEffect(() => setRange(value), [value]);

  const applyChange = (next?: DateRange) => {
    setRange(next);
    onChange?.(next);
  };

  const labelText = React.useMemo(() => {
    if (range?.from && range?.to) {
      return `${format(range.from, "EEE, dd MMM")} – ${format(range.to, "EEE, dd MMM")}`;
    }
    if (range?.from) {
      return `${format(range.from, "EEE, dd MMM")} – Add checkout`;
    }
    return label;
  }, [range, label]);

  const isDisabled = (day: Date) => {
    const target = startOfDay(day);
    if (isBefore(target, startOfDay(new Date()))) return true;
    if (isDateBlocked?.(target)) return true;
    if (range?.from && !range.to) {
      const earliestTo = addDays(startOfDay(range.from), Math.max(1, minNights));
      if (isBefore(target, earliestTo)) return true;
    }
    return false;
  };

  const handleSelect = (next?: DateRange) => {
    if (!next?.from) {
      applyChange(undefined);
      return;
    }
    if (!next.to) {
      setRange({ from: next.from, to: undefined });
      return;
    }
    const nights = differenceInCalendarDays(
      startOfDay(next.to),
      startOfDay(next.from)
    );
    if (nights < Math.max(1, minNights)) {
      const forcedTo = addDays(startOfDay(next.from), Math.max(1, minNights));
      applyChange({ from: next.from, to: forcedTo });
    } else {
      applyChange(next);
    }
  };

  const shortcuts = [
    {
      label: "Next weekend",
      getRange: () => {
        const today = startOfDay(new Date());
        const daysUntilFri = (5 - today.getDay() + 7) % 7 || 7;
        const from = addDays(today, daysUntilFri);
        const to = addDays(from, Math.max(2, minNights));
        return { from, to };
      },
    },
    {
      label: "7 nights",
      getRange: () => {
        const from = startOfDay(new Date());
        const to = addDays(from, Math.max(7, minNights));
        return { from, to };
      },
    },
    {
      label: "28 nights",
      getRange: () => {
        const from = startOfDay(new Date());
        const to = addDays(from, Math.max(28, minNights));
        return { from, to };
      },
    },
    { label: "Clear", getRange: () => undefined },
  ];

  return (
    <div className={className}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Select booking dates"
            className="flex w-full items-center gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-left text-sm shadow-sm transition hover:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          >
            <span className="truncate text-sm text-neutral-700">{labelText}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={10}
            className="rdp-airbnb z-50 w-[720px] max-w-[95vw] rounded-3xl border border-neutral-200 bg-white p-4 shadow-2xl focus:outline-none data-[side=bottom]:animate-in data-[side=bottom]:fade-in data-[side=bottom]:slide-in-from-top-2"
          >
            <div className="flex flex-col gap-4 md:flex-row">
              <div className="flex-1">
                <DayPicker
                  className="avyro-range-picker"
                  mode="range"
                  numberOfMonths={numberOfMonths}
                  selected={range}
                  onSelect={handleSelect}
                  onDayMouseEnter={(d) => setHoverDate(d)}
                  onDayMouseLeave={() => setHoverDate(undefined)}
                  weekStartsOn={1}
                  showOutsideDays
                  disabled={isDisabled}
                  modifiers={{
                    range_preview:
                      range?.from && !range?.to
                        ? getPreviewDays(range.from, hoverDate, isDisabled)
                        : [],
                  }}
                  modifiersClassNames={{
                    selected: "bg-[#0B0D10] text-white rounded-full hover:bg-[#0B0D10]",
                    range_start: "bg-[#0B0D10] text-white rounded-full hover:bg-[#0B0D10]",
                    range_end: "bg-[#0B0D10] text-white rounded-full hover:bg-[#0B0D10]",
                    range_middle: "bg-[#0B0D10]/10 text-[#0B0D10] rounded-none",
                    disabled: "text-neutral-300 line-through pointer-events-none",
                    today:
                      "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-[#FEDD02]",
                    range_preview: "bg-[#0B0D10]/5",
                  }}
                  classNames={{
                    months: "flex gap-6 flex-wrap",
                    month: "space-y-2",
                    caption: "flex justify-between items-center px-2 text-sm font-medium font-display",
                    nav: "flex gap-2",
                    head_row: "grid grid-cols-7 text-xs text-neutral-400",
                    head_cell: "text-center font-medium py-2 text-[#4B5563]",
                    row: "grid grid-cols-7 text-sm",
                    cell: "text-center py-1",
                    day: "mx-auto my-0 h-9 w-full rounded-none leading-9 text-[#4B5563] hover:bg-[#FEDD02]/15",
                  }}
                />
              </div>
              {showShortcuts && (
                <div className="w-full min-w-[220px] max-w-[240px] rounded-2xl border border-neutral-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                    Quick picks
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    {shortcuts.map((shortcut) => (
                      <button
                        key={shortcut.label}
                        className="rounded-lg px-3 py-2 text-left text-sm transition hover:bg-neutral-100"
                        onClick={() => {
                          const next = shortcut.getRange();
                          setHoverDate(undefined);
                          applyChange(next as DateRange | undefined);
                        }}
                      >
                        {shortcut.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => applyChange(undefined)}
                className="text-neutral-500 underline-offset-4 hover:underline"
              >
                Clear dates
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-2 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg bg-black px-4 py-2 font-medium text-white hover:bg-black/90"
                >
                  Save
                </button>
              </div>
            </div>
            <Popover.Arrow className="fill-white" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function getPreviewDays(
  from: Date,
  hover: Date | undefined,
  isDisabled: (date: Date) => boolean
) {
  if (!hover) return [];
  const start = startOfDay(from);
  const end = startOfDay(hover);
  const forward = !isBefore(end, start);
  const steps = Math.abs(differenceInCalendarDays(end, start));
  const dates: Date[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = addDays(start, forward ? i : -i);
    if (!isDisabled(d)) dates.push(d);
  }
  return dates;
}
