import { useEffect } from "react";
import { formatCurrency } from "@/lib/dateUtils";
import type { ReservationRecord } from "@/modules/calendar/types";
import { SharedCalendarBlock } from "@/components/shared-stay/SharedCalendarBlock";

type ReservationDrawerProps = {
  open: boolean;
  reservation: ReservationRecord | null;
  onClose: () => void;
  onMessageGuest: (reservation: ReservationRecord) => void;
  onViewBooking: (reservation: ReservationRecord) => void;
  onCopyAddress: (reservation: ReservationRecord) => void;
  onCancelBooking: (reservation: ReservationRecord) => void;
  copyStatus?: string | null;
  mobile?: boolean;
};

const formatDateTime = (value: string, withTime: boolean) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = withTime
    ? { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat("en-GB", options).format(date);
};

const formatDateOnly = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

export function ReservationDrawer({
  open,
  reservation,
  onClose,
  onMessageGuest,
  onViewBooking,
  onCopyAddress,
  onCancelBooking,
  copyStatus,
  mobile,
}: ReservationDrawerProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!reservation) return null;

  const status = String(reservation.status ?? "confirmed").replaceAll("_", " ");
  const canCancel = !reservation.isBlock && ["confirmed", "paid", "awaiting_payment"].includes(String(reservation.status));
  const withTime = reservation.bookingType === "hourly";

  return (
    <div className={`fixed inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-slate-900/25 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute bg-white shadow-2xl transition-transform duration-200 ease-out ${
          mobile
            ? "inset-x-0 bottom-0 h-[78vh] rounded-t-2xl border-t border-slate-200"
            : "right-0 top-0 h-full w-[380px] max-w-[92vw] border-l border-slate-200"
        } ${open ? "translate-y-0 translate-x-0" : mobile ? "translate-y-full" : "translate-x-full"}`}
      >
        <div className="h-full overflow-y-auto p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-semibold text-slate-600">{reservation.listingTitle}</p>
            <button
              type="button"
              className="h-8 w-8 rounded-full text-slate-500 hover:bg-slate-100"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <p className="text-xl font-semibold text-slate-900">{reservation.guestName || "Guest"}</p>
            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {status}
            </span>
            <span className="inline-flex rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600">
              {reservation.channel || "direct"}
            </span>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dates</p>
            <p className="mt-2 text-sm text-slate-900">
              {formatDateTime(reservation.start, withTime)} → {formatDateTime(reservation.end, withTime)}
            </p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Financial</p>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-900">
              <span>Total</span>
              <span className="font-semibold">
                {reservation.totalPence != null
                  ? formatCurrency(reservation.totalPence / 100, reservation.currency ?? "GBP")
                  : "—"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-900">
              <span>Payout estimate</span>
              <span className="font-semibold">
                {reservation.payoutEstimatePence != null
                  ? formatCurrency(reservation.payoutEstimatePence / 100, reservation.currency ?? "GBP")
                  : "—"}
              </span>
            </div>
            {reservation.flexExtraNight ? (
              <div className="mt-2 flex items-center justify-between text-sm text-slate-900">
                <span>Optional extra night</span>
                <span className="font-semibold">
                  {reservation.flexExtraNightPricePence != null
                    ? formatCurrency(reservation.flexExtraNightPricePence / 100, reservation.currency ?? "GBP")
                    : "Reserved"}
                </span>
              </div>
            ) : null}
          {reservation.flexMode === "rolling" ? (
              <>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-900">
                  <span>Confirmed through</span>
                  <span className="font-semibold">
                    {formatDateOnly(reservation.flexCurrentConfirmedEnd)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-900">
                  <span>Max possible end</span>
                  <span className="font-semibold">{formatDateOnly(reservation.flexMaxEnd)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-900">
                  <span>Next decision deadline</span>
                  <span className="font-semibold">
                    {reservation.flexExtensionCutoffAt
                      ? formatDateTime(reservation.flexExtensionCutoffAt, true)
                      : "—"}
                  </span>
                </div>
              </>
            ) : null}
            {reservation.sharedGroupId ? (
              <>
                <div className="mt-3">
                  <SharedCalendarBlock
                    startDate={reservation.start}
                    endDate={reservation.end}
                    filledSpots={reservation.sharedFilledSpots ?? 0}
                    pendingSpots={reservation.sharedPendingSpots ?? 0}
                    totalSpots={reservation.sharedTotalSpots ?? 0}
                  />
                </div>
              </>
            ) : null}
          </div>

          {reservation.address ? <p className="mt-4 text-sm text-slate-600">{reservation.address}</p> : null}

          <div className="mt-5 space-y-2">
            <button
              type="button"
              className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={() => onMessageGuest(reservation)}
              disabled={reservation.isBlock}
            >
              Message guest
            </button>
            <button
              type="button"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              onClick={() => onViewBooking(reservation)}
              disabled={reservation.isBlock}
            >
              View booking
            </button>
            <button
              type="button"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              onClick={() => onCopyAddress(reservation)}
              disabled={!reservation.address}
            >
              Copy address
            </button>
            {canCancel ? (
              <button
                type="button"
                className="w-full rounded-xl border border-red-200 bg-white px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                onClick={() => onCancelBooking(reservation)}
              >
                Cancel booking
              </button>
            ) : null}
          </div>

          {copyStatus ? <p className="mt-3 text-xs text-emerald-600">{copyStatus}</p> : null}
        </div>
      </aside>
    </div>
  );
}
