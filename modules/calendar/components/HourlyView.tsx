import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DayPilot, DayPilotCalendar } from "@daypilot/daypilot-lite-react";

import { formatLocalDate } from "@/lib/dateUtils";
import type { CalendarFeed, ReservationRecord } from "@/modules/calendar/types";
import { mapFeedToHourlyEvents } from "@/modules/calendar/utils/mapFeedToHourlyEvents";

type HourlyViewProps = {
  feed: CalendarFeed;
  day: Date;
  selectedReservationId?: string | null;
  onSelectReservation: (reservation: ReservationRecord) => void;
  onOpenContextMenu: (reservation: ReservationRecord, x: number, y: number) => void;
  onBlockTime: (selection: { listingId: string; startAt: string; endAt: string }) => Promise<void> | void;
  onSetHourlyRate?: (
    selection: { listingId: string; startAt: string; endAt: string },
    hourlyRate: number
  ) => Promise<void> | void;
};

type SelectionPayload = {
  listingId: string;
  startAt: string;
  endAt: string;
  anchorX: number;
  anchorY: number;
};

export function HourlyView({
  feed,
  day,
  selectedReservationId,
  onSelectReservation,
  onOpenContextMenu,
  onBlockTime,
  onSetHourlyRate,
}: HourlyViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  const [rateMode, setRateMode] = useState(false);
  const [rateValue, setRateValue] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const hourlyListings = useMemo(
    () => feed.listings.filter((listing) => listing.hourlyEnabled),
    [feed.listings]
  );

  const hourlyListingIds = useMemo(
    () => new Set(hourlyListings.map((listing) => listing.id)),
    [hourlyListings]
  );

  const hourlyFeed = useMemo<CalendarFeed>(
    () => ({
      ...feed,
      listings: hourlyListings,
      bookings: feed.bookings.filter(
        (booking) => booking.bookingType === "hourly" && hourlyListingIds.has(booking.listingId)
      ),
      blocks: feed.blocks.filter(
        (block) => block.blockType === "hourly" && hourlyListingIds.has(block.listingId)
      ),
    }),
    [feed, hourlyListingIds, hourlyListings]
  );

  const mapped = useMemo(() => mapFeedToHourlyEvents(hourlyFeed), [hourlyFeed]);

  const columns = useMemo(
    () =>
      hourlyListings.map((listing) => ({
        id: listing.id,
        name: listing.title,
      })),
    [hourlyListings]
  );

  const clearSelection = useCallback(() => {
    setSelection(null);
    setRateMode(false);
    setRateValue("");
  }, []);

  useEffect(() => {
    if (!selection) return;
    const onClick = (event: MouseEvent) => {
      if (popoverRef.current && popoverRef.current.contains(event.target as Node)) return;
      clearSelection();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [clearSelection, selection]);

  const calendarConfig = useMemo<DayPilot.CalendarConfig>(
    () => ({
      startDate: formatLocalDate(day),
      viewType: "Resources",
      columns,
      events: mapped.events,
      cellDuration: 30,
      heightSpec: "Full",
      height: 680,
      headerHeight: 34,
      businessBeginsHour: 0,
      businessEndsHour: 24,
      eventClickHandling: "Enabled",
      eventRightClickHandling: "Enabled",
      eventMoveHandling: "Disabled",
      eventResizeHandling: "Disabled",
      timeRangeSelectedHandling: "Enabled",
      durationBarVisible: false,
      showToolTip: true,
      theme: "calendar_default",
      onBeforeHeaderRender: (args) => {
        args.header.html = `<span class=\"text-slate-800\">${args.header.name}</span>`;
      },
      onBeforeEventRender: (args) => {
        const reservation = mapped.reservationsByEventId[String(args.data.id ?? "")];
        if (!reservation) return;
        if (selectedReservationId && reservation.id === selectedReservationId) {
          args.data.cssClass = `${String(args.data.cssClass ?? "")} avyro-dp-event--selected`;
        }
      },
      onEventClick: (args) => {
        const reservation = mapped.reservationsByEventId[String(args.e.id())];
        if (reservation) onSelectReservation(reservation);
      },
      onEventRightClick: (args: any) => {
        args.preventDefault();
        const reservation = mapped.reservationsByEventId[String(args.e.id())];
        if (!reservation) return;
        const x = args.originalEvent?.clientX ?? window.innerWidth / 2;
        const y = args.originalEvent?.clientY ?? 120;
        onOpenContextMenu(reservation, x, y);
      },
      onTimeRangeSelected: (args) => {
        const listingId = String(args.resource ?? "");
        if (!listingId) return;
        args.control.clearSelection();

        const rect = containerRef.current?.getBoundingClientRect();
        setSelection({
          listingId,
          startAt: args.start.toString("yyyy-MM-ddTHH:mm:ss"),
          endAt: args.end.toString("yyyy-MM-ddTHH:mm:ss"),
          anchorX: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
          anchorY: rect ? rect.top + 120 : 160,
        });
      },
    }),
    [columns, day, mapped, onOpenContextMenu, onSelectReservation, selectedReservationId]
  );

  if (!hourlyListings.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm font-semibold text-slate-800">No hourly listings yet</p>
        <p className="mt-1 text-sm text-slate-500">Enable hourly stays on a listing to use this view.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative bg-white p-1.5">
      <div className="avyro-daypilot-scheduler">
        <DayPilotCalendar {...calendarConfig} />
      </div>

      {selection ? (
        <div
          ref={popoverRef}
          className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
          style={{ left: selection.anchorX, top: selection.anchorY, transform: "translate(-50%, 0)" }}
        >
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Selection</p>
          <p className="mt-1 text-xs font-medium text-slate-700">
            {selection.startAt} → {selection.endAt}
          </p>

          <div className="mt-3 space-y-2">
            <button
              type="button"
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={async () => {
                setActionBusy(true);
                await onBlockTime(selection);
                setActionBusy(false);
                clearSelection();
              }}
              disabled={actionBusy}
            >
              Block time
            </button>

            {!rateMode ? (
              <button
                type="button"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => setRateMode(true)}
                disabled={actionBusy}
              >
                Set hourly rate
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  value={rateValue}
                  onChange={(event) => setRateValue(event.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Rate (£/hr)"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  onClick={async () => {
                    const parsed = Number(rateValue);
                    if (!Number.isInteger(parsed) || parsed <= 0 || !onSetHourlyRate) return;
                    setActionBusy(true);
                    await onSetHourlyRate(selection, parsed);
                    setActionBusy(false);
                    clearSelection();
                  }}
                  disabled={actionBusy || !onSetHourlyRate}
                >
                  Save hourly rate
                </button>
              </div>
            )}

            <button
              type="button"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
              onClick={clearSelection}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
