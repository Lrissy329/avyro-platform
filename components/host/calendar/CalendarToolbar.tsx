import { useState } from "react";
import type { CalendarChannel } from "./calendarStyles";

type CalendarToolbarProps = {
  viewMode: "timeline" | "two-week" | "month";
  onViewChange: (view: "timeline" | "two-week" | "month") => void;
  dateRangeLabel: string;
  listingId: string;
  onListingChange: (id: string) => void;
  listingOptions: Array<{ id: string; label: string }>;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  channelFilters: Record<CalendarChannel, boolean>;
  onToggleChannel: (channel: CalendarChannel) => void;
  showCancelled: boolean;
  onToggleCancelled: () => void;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
};

const VIEW_OPTIONS: Array<{ key: "timeline" | "two-week" | "month"; label: string }> = [
  { key: "timeline", label: "Timeline" },
  { key: "two-week", label: "2-week" },
  { key: "month", label: "Month" },
];

const CHANNEL_LABELS: Record<CalendarChannel, string> = {
  direct: "Direct",
  airbnb: "Airbnb",
  vrbo: "Vrbo",
  booking: "Booking",
  expedia: "Expedia",
  manual: "Manual",
  other: "Other",
};

export function CalendarToolbar({
  viewMode,
  onViewChange,
  dateRangeLabel,
  listingId,
  onListingChange,
  listingOptions,
  onToday,
  onPrev,
  onNext,
  channelFilters,
  onToggleChannel,
  showCancelled,
  onToggleCancelled,
  searchQuery,
  onSearchChange,
}: CalendarToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center rounded-lg border border-slate-200 bg-white">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.key}
              className={`px-3 py-1.5 text-sm font-medium ${
                viewMode === option.key
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => onViewChange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 text-center text-sm font-semibold text-slate-700 truncate">
        {dateRangeLabel}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {onSearchChange && (
          <input
            value={searchQuery ?? ""}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search listings"
            className="md:hidden rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
          />
        )}
        <button
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          onClick={onToday}
        >
          Today
        </button>
        <button
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          onClick={onPrev}
        >
          Prev
        </button>
        <button
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          onClick={onNext}
        >
          Next
        </button>
        <select
          value={listingId}
          onChange={(event) => onListingChange(event.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All listings</option>
          {listingOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="relative">
          <button
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setFiltersOpen((prev) => !prev)}
          >
            Filters
          </button>
          {filtersOpen && (
            <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Channels
              </p>
              <div className="mt-2 space-y-2">
                {Object.entries(channelFilters).map(([channel, active]) => (
                  <label key={channel} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => onToggleChannel(channel as CalendarChannel)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900"
                    />
                    {CHANNEL_LABELS[channel as CalendarChannel]}
                  </label>
                ))}
              </div>
              <div className="mt-3 border-t border-slate-200 pt-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={showCancelled}
                    onChange={onToggleCancelled}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900"
                  />
                  Show cancelled
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
