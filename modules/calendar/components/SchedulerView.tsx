import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DayPilot, DayPilotScheduler } from "@daypilot/daypilot-lite-react";

import { formatCurrency, formatLocalDate, formatRangeSummary } from "@/lib/dateUtils";
import type { CalendarFeed, ReservationRecord } from "@/modules/calendar/types";
import { mapFeedToSchedulerEvents } from "@/modules/calendar/utils/mapFeedToSchedulerEvents";

type SelectionPayload = {
  listingId: string;
  start: string;
  end: string;
  anchorX: number;
  anchorY: number;
};

type SchedulerViewProps = {
  feed: CalendarFeed;
  startDate: Date;
  days: number;
  selectedReservationId?: string | null;
  onSelectReservation: (reservation: ReservationRecord) => void;
  onOpenContextMenu: (reservation: ReservationRecord, x: number, y: number) => void;
  onBlockDates: (selection: { listingId: string; startDate: string; endDate: string }) => Promise<void> | void;
  onSetRate: (
    selection: { listingId: string; startDate: string; endDate: string },
    nightlyRate: number
  ) => Promise<void> | void;
};

export function SchedulerView({
  feed,
  startDate,
  days,
  selectedReservationId,
  onSelectReservation,
  onOpenContextMenu,
  onBlockDates,
  onSetRate,
}: SchedulerViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const schedulerRef = useRef<DayPilot.Scheduler | null>(null);
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  const [rateMode, setRateMode] = useState(false);
  const [rateValue, setRateValue] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(640);

  const mapped = useMemo(() => mapFeedToSchedulerEvents(feed), [feed]);

  const resources = useMemo<DayPilot.ResourceData[]>(
    () =>
      feed.listings.map((listing) => ({
        id: listing.id,
        name: listing.title,
      })),
    [feed.listings]
  );

  const reservationByEventId = mapped.reservationsByEventId;

  const clearSelection = useCallback(() => {
    setSelection(null);
    setRateMode(false);
    setRateValue("");
  }, []);

  useEffect(() => {
    if (!selection) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    const handleClick = (event: MouseEvent) => {
      if (popoverRef.current && popoverRef.current.contains(event.target as Node)) return;
      clearSelection();
    };

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [selection, clearSelection]);

  useEffect(() => {
    const updateHeight = () => {
      const topOffset = containerRef.current?.getBoundingClientRect().top ?? 240;
      const nextHeight = Math.max(520, Math.floor(window.innerHeight - topOffset - 20));
      setViewportHeight(nextHeight);
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  const todayIso = formatLocalDate(new Date());

  const schedulerConfig = useMemo<DayPilot.SchedulerConfig>(
    () => ({
      startDate: formatLocalDate(startDate),
      days,
      scale: "Day",
      timeHeaders: [
        { groupBy: "Month", format: "MMMM yyyy" },
        { groupBy: "Day", format: "ddd d" },
      ],
      resources,
      events: mapped.events,
      rowHeaderWidth: 236,
      cellWidth: days >= 28 ? 92 : 100,
      headerHeight: 48,
      eventHeight: 40,
      eventBorderRadius: 12,
      rowMarginTop: 14,
      rowMarginBottom: 14,
      rowMinHeight: 88,
      eventMoveHandling: "Disabled",
      eventResizeHandling: "Disabled",
      eventClickHandling: "Enabled",
      eventRightClickHandling: "Enabled",
      timeRangeSelectedHandling: "Enabled",
      dynamicEventRendering: "Progressive",
      progressiveRowRendering: true,
      durationBarVisible: false,
      showToolTip: true,
      heightSpec: "Max",
      height: viewportHeight,
      width: "100%",
      theme: "scheduler_default",
      onBeforeCellRender: (args) => {
        const listingId = String(args.cell.resource ?? "");
        const iso = args.cell.start.toString("yyyy-MM-dd");
        const dayNumber = new Date(`${iso}T00:00:00`).getDay();
        const isWeekend = dayNumber === 0 || dayNumber === 6;
        const state = mapped.cellStatesByListingDate[`${listingId}::${iso}`];
        const nightlyRate = feed.rates?.[listingId]?.[iso];
        const rateLabel = nightlyRate != null ? formatCurrency(nightlyRate, "GBP") ?? "" : "";
        const isToday = iso === todayIso;
        const markerClass = state ? `avyro-dp-cell-marker avyro-dp-cell-marker--${state}` : "";

        args.cell.properties.cssClass = [
          "avyro-dp-cell",
          isToday ? "avyro-dp-cell--today" : "",
          isWeekend ? "avyro-dp-cell--weekend" : "",
          state === "booked" ? "avyro-dp-cell--booked" : "",
          state === "blocked" ? "avyro-dp-cell--blocked" : "",
        ]
          .filter(Boolean)
          .join(" ");

        args.cell.properties.html = `<div class=\"avyro-dp-cell-content\">${
          rateLabel ? `<span class=\"avyro-dp-cell-rate\">${rateLabel}</span>` : "<span></span>"
        }${
          markerClass ? `<span class=\"${markerClass}\"></span>` : ""
        }</div>`;
      },
      onEventClick: (args) => {
        const reservation = reservationByEventId[String(args.e.id())];
        if (reservation) onSelectReservation(reservation);
      },
      onEventRightClick: (args) => {
        args.preventDefault();
        const reservation = reservationByEventId[String(args.e.id())];
        if (!reservation) return;
        onOpenContextMenu(reservation, args.originalEvent.clientX, args.originalEvent.clientY);
      },
      onTimeRangeSelected: (args) => {
        const listingId = String(args.resource ?? "");
        if (!listingId) return;

        const startIso = args.start.toString("yyyy-MM-dd");
        const endIso = args.end.addDays(-1).toString("yyyy-MM-dd");
        args.control.clearSelection();

        const rect = containerRef.current?.getBoundingClientRect();
        const coords = args.control.getCoords();
        const rawX = coords?.x ?? (rect ? rect.width / 2 : window.innerWidth / 2);
        const rawY = coords?.y ?? 120;
        const anchorX = rect
          ? Math.max(rect.left + 130, Math.min(rect.left + rawX, rect.right - 130))
          : rawX;
        const anchorY = rect
          ? Math.max(rect.top + 76, Math.min(rect.top + rawY + 22, rect.bottom - 76))
          : rawY;

        setSelection({
          listingId,
          start: startIso,
          end: endIso,
          anchorX,
          anchorY,
        });
      },
      onBeforeEventRender: (args) => {
        const reservation = reservationByEventId[String(args.data.id ?? "")];
        if (!reservation) return;
        const isCancelled = String(reservation.status ?? "").toLowerCase() === "cancelled";
        if (selectedReservationId && String(reservation.id) === String(selectedReservationId)) {
          args.data.cssClass = `${String(args.data.cssClass ?? "")} avyro-dp-event--selected`;
        }
        if (isCancelled) {
          args.data.backColor = "#cbd5e1";
          args.data.fontColor = "#334155";
        }
      },
    }),
    [
      days,
      feed.rates,
      mapped,
      onOpenContextMenu,
      onSelectReservation,
      reservationByEventId,
      resources,
      selectedReservationId,
      startDate,
      todayIso,
      viewportHeight,
    ]
  );

  if (!resources.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No listings found for this account.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative min-h-[520px] overflow-hidden bg-white">
      <div className="avyro-daypilot-scheduler">
        <DayPilotScheduler controlRef={(control) => (schedulerRef.current = control)} {...schedulerConfig} />
      </div>

      {selection ? (
        <div
          ref={popoverRef}
          className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
          style={{ left: selection.anchorX, top: selection.anchorY, transform: "translate(-50%, 0)" }}
        >
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Selection</p>
          <p className="mt-1 text-xs font-medium text-slate-700">
            {formatRangeSummary(new Date(selection.start), new Date(selection.end))}
          </p>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={async () => {
                setActionBusy(true);
                await onBlockDates({
                  listingId: selection.listingId,
                  startDate: selection.start,
                  endDate: selection.end,
                });
                setActionBusy(false);
                clearSelection();
              }}
              disabled={actionBusy}
            >
              Block dates
            </button>
            {!rateMode ? (
              <button
                type="button"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => setRateMode(true)}
                disabled={actionBusy}
              >
                Set nightly rate
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  value={rateValue}
                  onChange={(event) => setRateValue(event.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Rate (£)"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  onClick={async () => {
                    const parsed = Number(rateValue);
                    if (!Number.isInteger(parsed) || parsed <= 0) return;
                    setActionBusy(true);
                    await onSetRate(
                      {
                        listingId: selection.listingId,
                        startDate: selection.start,
                        endDate: selection.end,
                      },
                      parsed
                    );
                    setActionBusy(false);
                    clearSelection();
                  }}
                  disabled={actionBusy}
                >
                  Save rate
                </button>
              </div>
            )}
            <button
              type="button"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500"
              disabled
              title="Optional action"
            >
              Set min nights (soon)
            </button>
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
