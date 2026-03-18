import type { HostCalendarView } from "@/modules/calendar/types";
import { HostCalendarViewToggle } from "@/modules/calendar/components/HostCalendarViewToggle";

type ListingOption = {
  id: string;
  label: string;
};

type CalendarToolbarProps = {
  view: HostCalendarView;
  onViewChange: (view: HostCalendarView) => void;
  dateLabel: string;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  listingId: string;
  listingOptions: ListingOption[];
  onListingChange: (listingId: string) => void;
  includeCancelled: boolean;
  onToggleCancelled: () => void;
  channel: string;
  onChannelChange: (channel: string) => void;
};

const CHANNEL_OPTIONS = [
  { value: "all", label: "All channels" },
  { value: "direct", label: "Direct" },
  { value: "airbnb", label: "Airbnb" },
  { value: "vrbo", label: "Vrbo" },
  { value: "booking", label: "Booking.com" },
  { value: "expedia", label: "Expedia" },
  { value: "manual", label: "Manual" },
  { value: "other", label: "Other" },
];

export function CalendarToolbar({
  view,
  onViewChange,
  dateLabel,
  onPrev,
  onToday,
  onNext,
  listingId,
  listingOptions,
  onListingChange,
  includeCancelled,
  onToggleCancelled,
  channel,
  onChannelChange,
}: CalendarToolbarProps) {
  const activeChannelLabel =
    CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? "All channels";

  return (
    <div className="bg-white px-3 py-2 md:px-4 md:py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <HostCalendarViewToggle value={view} onChange={onViewChange} />
          <span className="hidden text-sm font-semibold text-slate-800 md:inline">{dateLabel}</span>
        </div>
        <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5">
          <button
            type="button"
            onClick={onPrev}
            className="h-7 rounded-md px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={onToday}
            className="h-7 rounded-md bg-slate-900 px-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onNext}
            className="h-7 rounded-md px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Next
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Listings</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={listingId}
            onChange={(event) => onListingChange(event.target.value)}
            className="h-8 w-auto min-w-[180px] rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
          >
            <option value="all">All listings</option>
            {listingOptions.map((listing) => (
              <option key={listing.id} value={listing.id}>
                {listing.label}
              </option>
            ))}
          </select>
          <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={onToggleCancelled}
              className="h-3.5 w-3.5"
            />
            Show cancelled
          </label>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Channels</span>
        {CHANNEL_OPTIONS.map((option) => {
          const active = channel === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChannelChange(option.value)}
              className={`h-7 rounded-full border px-2.5 text-xs font-semibold transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {option.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-slate-400">Filtering: {activeChannelLabel}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2.5 border-t border-slate-200 pt-1.5 text-xs text-slate-500">
        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Legend</span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full border border-slate-300 bg-white" />
          Available
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-900" />
          Booked
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
          Blocked
        </span>
      </div>
    </div>
  );
}
