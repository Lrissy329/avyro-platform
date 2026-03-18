import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  bookingNights,
  formatDate,
  formatDateRange,
  isAddressCopyAllowed,
  resolveBookingCheckIn,
  resolveBookingCheckOut,
  statusClassName,
  statusLabel,
  type GuestBookingRecord,
  type GuestHostRecord,
  type GuestListingRecord,
  type ReviewEligibility,
} from "@/components/guest/bookingUtils";

type GuestStayCardProps = {
  booking: GuestBookingRecord;
  listing?: GuestListingRecord | null;
  host?: GuestHostRecord | null;
  mode: "current" | "upcoming" | "past";
  reviewEligibility?: ReviewEligibility | null;
  reviewEligibilityLoading?: boolean;
  onLeaveReview?: () => void;
};

export function GuestStayCard({
  booking,
  listing,
  host,
  mode,
  reviewEligibility,
  reviewEligibilityLoading,
  onLeaveReview,
}: GuestStayCardProps) {
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");

  const checkIn = resolveBookingCheckIn(booking);
  const checkOut = resolveBookingCheckOut(booking);
  const status = String(booking.status ?? "").toLowerCase();
  const nights = bookingNights(booking);
  const address = listing?.address?.trim() || listing?.location?.trim() || "";

  const handleCopyAddress = async () => {
    if (!address || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 1600);
    }
  };

  const cardAccent =
    mode === "current"
      ? "border-yellow-300 bg-yellow-50/40"
      : "border-slate-200 bg-white";

  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${cardAccent}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{listing?.title ?? "Listing"}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {listing?.location ?? "Location pending"}
            {host ? (
              <>
                {" "}· Hosted by {host.full_name ?? host.email ?? "Host"}
              </>
            ) : null}
          </p>
        </div>
        <Badge className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName(status)}`}>
          {mode === "current" ? "Current stay" : statusLabel(status)}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Dates</p>
          <p className="mt-1 font-medium text-slate-900">{formatDateRange(checkIn, checkOut)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">
            {mode === "past" ? "Stayed" : "Check-in"}
          </p>
          <p className="mt-1 font-medium text-slate-900">
            {mode === "past" ? formatDate(checkOut) : formatDate(checkIn)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Nights</p>
          <p className="mt-1 font-medium text-slate-900">{nights ? `${nights} night${nights > 1 ? "s" : ""}` : "—"}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/guest/bookings/${booking.id}`}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          View booking
        </Link>
        <Link
          href={`/guest/messages?bookingId=${encodeURIComponent(booking.id)}`}
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Message host
        </Link>

        {isAddressCopyAllowed(status) && address ? (
          <button
            type="button"
            onClick={handleCopyAddress}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {copyState === "done" ? "Address copied" : copyState === "error" ? "Copy failed" : "Copy address"}
          </button>
        ) : null}

        {mode === "past" ? (
          <div className="ml-auto text-sm">
            {reviewEligibilityLoading ? (
              <span className="text-slate-500">Checking review status…</span>
            ) : reviewEligibility?.guestAlreadyReviewed ? (
              <span className="font-semibold text-emerald-700">Review submitted</span>
            ) : reviewEligibility?.canGuestReview ? (
              <Button
                type="button"
                onClick={onLeaveReview}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Leave review
              </Button>
            ) : (
              <span className="text-slate-500">
                {reviewEligibility?.reviewWindowExpiresAt
                  ? `Review closed ${formatDate(reviewEligibility.reviewWindowExpiresAt)}`
                  : "No review needed"}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
