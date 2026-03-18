import { useMemo } from "react";
import { DayPilot, DayPilotMonth } from "@daypilot/daypilot-lite-react";

import { formatLocalDate } from "@/lib/dateUtils";
import type { CalendarFeed, ReservationRecord } from "@/modules/calendar/types";
import { mapFeedToMonthEvents } from "@/modules/calendar/utils/mapFeedToMonthEvents";

type MonthViewProps = {
  feed: CalendarFeed;
  monthStart: Date;
  selectedReservationId?: string | null;
  onSelectReservation: (reservation: ReservationRecord) => void;
  onOpenContextMenu: (reservation: ReservationRecord, x: number, y: number) => void;
};

export function MonthView({
  feed,
  monthStart,
  selectedReservationId,
  onSelectReservation,
  onOpenContextMenu,
}: MonthViewProps) {
  const mapped = useMemo(() => mapFeedToMonthEvents(feed), [feed]);
  const todayIso = formatLocalDate(new Date());

  const config = useMemo<DayPilot.MonthConfig>(
    () => ({
      startDate: formatLocalDate(monthStart),
      events: mapped.events,
      eventClickHandling: "Enabled",
      eventRightClickHandling: "Enabled",
      eventMoveHandling: "Disabled",
      eventResizeHandling: "Disabled",
      timeRangeSelectedHandling: "Disabled",
      showToolTip: true,
      cellHeight: 132,
      eventHeight: 20,
      lineSpace: 1,
      theme: "month_default",
      onBeforeCellRender: (args) => {
        const iso = args.cell.start.toString("yyyy-MM-dd");
        if (iso === todayIso) {
          args.cell.properties.backColor = "#f8fafc";
        }
      },
      onBeforeEventRender: (args) => {
        const reservation = mapped.reservationsByEventId[String(args.data.id ?? "")];
        if (!reservation) return;
        if (selectedReservationId && reservation.id === selectedReservationId) {
          args.data.borderColor = "rgba(15,23,42,0.35)";
          args.data.borderRadius = 10;
        }
        args.data.text = reservation.isBlock ? "Blocked" : (reservation.guestName?.split(" ")[0] || "Guest");
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
    }),
    [mapped, monthStart, onOpenContextMenu, onSelectReservation, selectedReservationId, todayIso]
  );

  return (
    <div className="bg-white p-1.5">
      <div className="avyro-daypilot-scheduler">
        <DayPilotMonth {...config} />
      </div>
    </div>
  );
}
