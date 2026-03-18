import type { RefObject } from "react";
import type { CalendarListing } from "./useCalendarData";
import { ROW_HEIGHT } from "./calendarStyles";

type ListingRailProps = {
  listings: CalendarListing[];
  selectedId: string;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  scrollRef?: RefObject<HTMLDivElement>;
};

export function ListingRail({
  listings,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  scrollRef,
}: ListingRailProps) {
  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2">
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search listings"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-hidden">
        {listings.map((listing) => {
          const active = selectedId === listing.id;
          return (
            <button
              key={listing.id}
              className={`relative w-full border-b border-slate-100 px-3 text-left transition flex flex-col justify-center ${
                active ? "bg-slate-50" : "hover:bg-slate-50"
              }`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onSelect(listing.id)}
            >
              {active && <span className="absolute left-0 top-0 h-full w-1 bg-yellow-400" />}
              <p className="truncate text-sm text-slate-900">{listing.title}</p>
              {listing.subtitle && (
                <p className="truncate text-xs text-slate-500">{listing.subtitle}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
