import type { CSSProperties, MouseEvent } from "react";
import type { CalendarReservation } from "./useCalendarData";
import { getReservationTheme } from "./calendarStyles";

type ReservationBarProps = {
  reservation: CalendarReservation;
  style: CSSProperties;
  badgeIcon: string;
  selected?: boolean;
  onContextMenu?: (reservation: CalendarReservation, event: MouseEvent<HTMLDivElement>) => void;
  onClick: (reservation: CalendarReservation) => void;
  onHover: (
    reservation: CalendarReservation,
    event: MouseEvent<HTMLDivElement>
  ) => void;
  onLeave: () => void;
};

export function ReservationBar({
  reservation,
  style,
  badgeIcon,
  selected = false,
  onContextMenu,
  onClick,
  onHover,
  onLeave,
}: ReservationBarProps) {
  const theme = getReservationTheme(reservation.channel, reservation.status);
  const guestName = reservation.guestName?.trim() || "Guest";
  const guestFirst = guestName.split(" ")[0] || "Guest";

  return (
    <div
      className={`absolute flex h-8 items-center justify-between gap-2 rounded-lg px-2 text-[12px] font-medium ${theme.bgClass} ${theme.textClass} ${
        theme.faded ? "opacity-60" : ""
      } ${selected ? "ring-2 ring-slate-900/10" : ""}`}
      style={style}
      onClick={() => onClick(reservation)}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(reservation, event);
      }}
      onMouseEnter={(event) => onHover(reservation, event)}
      onMouseLeave={onLeave}
      data-reservation-bar="true"
    >
      <span className="truncate whitespace-nowrap">{guestFirst}</span>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${theme.badgeBgClass}`}>
        <img src={badgeIcon} alt={reservation.channel} className="h-3 w-3" />
      </span>
    </div>
  );
}
