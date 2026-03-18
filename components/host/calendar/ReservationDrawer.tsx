import { useEffect, useState } from "react";
import type { CalendarListing, CalendarReservation } from "./useCalendarData";
import { formatCurrency } from "@/lib/dateUtils";

type ReservationDrawerProps = {
  reservation: CalendarReservation | null;
  listing: CalendarListing | null;
  onClose: () => void;
  onMessageGuest: (reservation: CalendarReservation) => void;
  onViewBooking: (reservation: CalendarReservation) => void;
  onCopyAddress: (address?: string) => void;
  onCancelBooking?: (reservation: CalendarReservation) => void;
  onSaveNote?: (reservation: CalendarReservation, note: string) => Promise<void> | void;
  canCancel?: boolean;
  copyStatus?: string | null;
};

export function ReservationDrawer({
  reservation,
  listing,
  onClose,
  onMessageGuest,
  onViewBooking,
  onCopyAddress,
  onCancelBooking,
  onSaveNote,
  canCancel,
  copyStatus,
}: ReservationDrawerProps) {
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    setNoteDraft("");
  }, [reservation?.id]);

  if (!reservation) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm text-sm text-slate-500">
        Select a booking to see details.
      </div>
    );
  }

  const statusLabel = reservation.status.replace("_", " ");
  const statusClass =
    reservation.status === "paid"
      ? "bg-emerald-50 text-emerald-700"
      : reservation.status === "awaiting_payment"
        ? "bg-amber-50 text-amber-700"
        : reservation.status === "cancelled"
          ? "bg-red-50 text-red-600"
          : "bg-slate-100 text-slate-700";

  const channelLabel =
    reservation.channel === "direct"
      ? "Direct"
      : reservation.channel.charAt(0).toUpperCase() + reservation.channel.slice(1);

  const nights = Math.max(1, Math.ceil(
    (new Date(reservation.endDate).getTime() - new Date(reservation.startDate).getTime()) /
      86400000
  ));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600 truncate">
          {listing?.title ?? "Listing"}
        </p>
        <button
          className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="mt-3">
        <div className="flex items-center gap-2">
          <p className="text-xl font-semibold text-slate-900">
            {reservation.guestName ?? "Guest"}
          </p>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>
            {statusLabel}
          </span>
          <span className="inline-flex rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600">
            {channelLabel}
          </span>
        </div>
        {reservation.addressLine && (
          <p className="text-sm text-slate-600 truncate">{reservation.addressLine}</p>
        )}
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold text-slate-500 tracking-wide uppercase">Dates</p>
        <p className="mt-2 text-sm text-slate-900">
          {reservation.startDate} → {reservation.endDate}
        </p>
        <p className="mt-1 text-xs text-slate-500">{nights} nights</p>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold text-slate-500 tracking-wide uppercase">Financial</p>
        <div className="mt-2 flex items-center justify-between text-sm text-slate-900">
          <span>Total</span>
          <span className="font-semibold text-right">
            {reservation.totalPence != null
              ? formatCurrency((reservation.totalPence ?? 0) / 100, reservation.currency ?? "GBP")
              : "—"}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm text-slate-900">
          <span>Payout estimate</span>
          <span className="font-semibold text-right">
            {reservation.payoutEstimatePence != null
              ? formatCurrency((reservation.payoutEstimatePence ?? 0) / 100, reservation.currency ?? "GBP")
              : "—"}
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <button
          className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
          onClick={() => onMessageGuest(reservation)}
        >
          Message guest
        </button>
        <button
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
          onClick={() => onViewBooking(reservation)}
        >
          View booking
        </button>
        {canCancel && onCancelBooking && (
          <button
            className="w-full rounded-xl border border-red-200 bg-white px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={() => onCancelBooking(reservation)}
          >
            Cancel booking
          </button>
        )}
      </div>

      <div className="mt-4">
        <button
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          onClick={() => onCopyAddress(reservation.addressLine)}
          disabled={!reservation.addressLine}
        >
          Copy address
        </button>
        {copyStatus && <span className="ml-2 text-xs text-emerald-600">{copyStatus}</span>}
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold text-slate-500 tracking-wide uppercase">Notes</p>
        <textarea
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Add a private note…"
          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
          rows={3}
        />
        <button
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          onClick={async () => {
            if (!onSaveNote || !noteDraft.trim()) return;
            setSavingNote(true);
            await onSaveNote(reservation, noteDraft.trim());
            setSavingNote(false);
            setNoteDraft("");
          }}
          disabled={savingNote || !noteDraft.trim() || !onSaveNote}
        >
          Save note
        </button>
        <p className="mt-2 text-xs text-slate-400">
          Notes are visible only to you and your team.
        </p>
      </div>
    </div>
  );
}
