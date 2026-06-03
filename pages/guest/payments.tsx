import Link from "next/link";
import { useMemo } from "react";

import { GuestPageHeader } from "@/components/guest/GuestPageHeader";
import { GuestShellLayout } from "@/components/guest/GuestShellLayout";
import {
  bookingReference,
  formatDate,
  statusClassName,
  statusLabel,
} from "@/components/guest/bookingUtils";
import { Card } from "@/components/ui/card";
import { useGuestBookingsData } from "@/hooks/useGuestBookingsData";

const formatMoney = (amountMajor: number, currency = "GBP") =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMajor);

export default function GuestPaymentsPage() {
  const { loading, error, bookings, listingById } = useGuestBookingsData();

  const paymentRows = useMemo(
    () =>
      bookings.map((booking) => {
        const amountMajor =
          booking.guest_total_pence != null
            ? booking.guest_total_pence / 100
            : typeof booking.price_total === "number"
            ? booking.price_total
            : 0;

        return {
          booking,
          listing: listingById[booking.listing_id] ?? null,
          amountMajor,
          currency: booking.currency ?? "GBP",
        };
      }),
    [bookings, listingById]
  );

  return (
    <GuestShellLayout activeNav="payments" title="Payments">
      <div className="space-y-8">
        <GuestPageHeader
          title="Payments"
          description="Track payment amounts and status for each booking."
        />

        {error ? (
          <Card className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
            {error}
          </Card>
        ) : null}

        {loading ? (
          <Card className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
            Loading payments…
          </Card>
        ) : paymentRows.length === 0 ? (
          <Card className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
            No payments yet.
          </Card>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Booking ref</th>
                    <th className="px-4 py-3">Property</th>
                    <th className="px-4 py-3">Amount paid</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Date paid</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paymentRows.map(({ booking, listing, amountMajor, currency }) => (
                    <tr key={booking.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{bookingReference(booking.id)}</td>
                      <td className="px-4 py-3 text-slate-700">{listing?.title ?? "Listing"}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {formatMoney(amountMajor, currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClassName(booking.status, booking.stripe_status)}`}>
                          {statusLabel(booking.status, booking.stripe_status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(booking.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/guest/bookings/${booking.id}`}
                          className="text-sm font-semibold text-slate-700 hover:text-slate-900"
                        >
                          View booking
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </GuestShellLayout>
  );
}
