import type { CalendarReservation } from "./useCalendarData";
import { formatCurrency } from "@/lib/dateUtils";

type ReservationTooltipProps = {
  reservation: CalendarReservation;
  x: number;
  y: number;
};

export function ReservationTooltip({ reservation, x, y }: ReservationTooltipProps) {
  const statusLabel = reservation.status.replace("_", " ");
  const statusClass =
    reservation.status === "paid"
      ? "bg-emerald-50 text-emerald-700"
      : reservation.status === "awaiting_payment"
        ? "bg-amber-50 text-amber-700"
        : reservation.status === "cancelled"
          ? "bg-red-50 text-red-600"
          : "bg-slate-100 text-slate-600";

  return (
    <div
      className="pointer-events-none fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg"
      style={{ left: x, top: y, transform: "translate(-50%, -100%)" }}
    >
      <p className="text-[11px] uppercase tracking-wider text-slate-400">
        {reservation.channel}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{reservation.guestName ?? "Guest"}</p>
      <p className="mt-1 text-[11px] text-slate-600">
        {reservation.startDate} → {reservation.endDate}
      </p>
      <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass}`}>
        {statusLabel}
      </span>
      {reservation.totalPence != null && (
        <p className="mt-1 text-[11px] text-slate-600">
          Total:{" "}
          {formatCurrency((reservation.totalPence ?? 0) / 100, reservation.currency ?? "GBP")}
        </p>
      )}
      <p className="mt-1 text-[11px] text-slate-500">Click for details</p>
    </div>
  );
}
