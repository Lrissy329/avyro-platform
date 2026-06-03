import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { GuestPageHeader } from "@/components/guest/GuestPageHeader";
import { RollingFlexCard } from "@/components/guest/RollingFlexCard";
import { GuestShellLayout } from "@/components/guest/GuestShellLayout";
import { FlexStayCard } from "@/components/guest/FlexStayCard";
import { SharedBookingCard } from "@/components/shared-stay/SharedBookingCard";
import {
  bookingNights,
  bookingReference,
  canGuestCancel,
  formatDate,
  formatDateRange,
  resolveBookingCheckIn,
  resolveBookingCheckOut,
  statusClassName,
  statusLabel,
  type ReviewEligibility,
} from "@/components/guest/bookingUtils";
import { ReviewFormModal } from "@/components/reviews/ReviewFormModal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useGuestBookingsData } from "@/hooks/useGuestBookingsData";
import { supabase } from "@/lib/supabaseClient";

const formatMoney = (amountMajor: number, currency = "GBP") =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMajor);

export default function GuestBookingDetailPage() {
  const router = useRouter();
  const bookingId = typeof router.query.id === "string" ? router.query.id : "";

  const { loading, error, userId, bookings, listingById, hostById, refresh } = useGuestBookingsData();

  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [reviewEligibility, setReviewEligibility] = useState<ReviewEligibility | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const [flexBusy, setFlexBusy] = useState<false | "confirm" | "decline" | "extend" | "release">(false);
  const [flexError, setFlexError] = useState<string | null>(null);

  const booking = useMemo(
    () => bookings.find((row) => row.id === bookingId) ?? null,
    [bookings, bookingId]
  );

  const listing = booking ? listingById[booking.listing_id] ?? null : null;
  const host = booking?.host_id ? hostById[booking.host_id] ?? null : null;

  useEffect(() => {
    if (!booking) return;
    setLocalStatus(booking.status);
  }, [booking]);

  const loadReviewEligibility = useCallback(async () => {
    if (!booking?.id) return;
    setReviewLoading(true);
    try {
      const response = await fetch(
        `/api/reviews/eligibility?bookingId=${encodeURIComponent(booking.id)}`
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load review eligibility.");
      }
      setReviewEligibility(payload as ReviewEligibility);
    } catch (err) {
      console.error("[guest booking] review eligibility failed", err);
      setReviewEligibility(null);
    } finally {
      setReviewLoading(false);
    }
  }, [booking?.id]);

  useEffect(() => {
    loadReviewEligibility().catch(() => null);
  }, [loadReviewEligibility]);

  const handleCancelBooking = useCallback(async () => {
    if (!booking?.id || !userId || !canGuestCancel(localStatus ?? booking.status, booking.stripe_status)) return;

    const confirmed = window.confirm(
      "Cancel this booking? We’ll notify the host and release the dates."
    );
    if (!confirmed) return;

    setCanceling(true);
    try {
      const { error: cancelError } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id)
        .eq("guest_id", userId);

      if (cancelError) throw cancelError;
      setLocalStatus("cancelled");
    } catch (err: any) {
      alert(err?.message ?? "Unable to cancel booking.");
    } finally {
      setCanceling(false);
    }
  }, [booking, localStatus, userId]);

  const handleCopyAddress = useCallback(async () => {
    const address = listing?.address?.trim() || listing?.location?.trim() || "";
    if (!address || !navigator?.clipboard) return;

    try {
      await navigator.clipboard.writeText(address);
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 1400);
    }
  }, [listing]);

  const handleConfirmFlexNight = useCallback(async () => {
    if (!booking?.id) return;
    setFlexBusy("confirm");
    setFlexError(null);
    try {
      const response = await fetch("/api/flex/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to confirm extra night.");
      }
      await refresh();
    } catch (err: any) {
      setFlexError(err?.message ?? "Unable to confirm extra night.");
    } finally {
      setFlexBusy(false);
    }
  }, [booking?.id, refresh]);

  const handleDeclineFlexNight = useCallback(async () => {
    if (!booking?.id) return;
    setFlexBusy("release");
    setFlexError(null);
    try {
      const response = await fetch("/api/flex/release", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to decline extra night.");
      }
      await refresh();
    } catch (err: any) {
      setFlexError(err?.message ?? "Unable to decline extra night.");
    } finally {
      setFlexBusy(false);
    }
  }, [booking?.id, refresh]);

  const handleExtendRollingFlex = useCallback(async () => {
    if (!booking?.id) return;
    setFlexBusy("extend");
    setFlexError(null);
    try {
      const response = await fetch("/api/flex/extend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload?.code === "FLEX_PAYMENT_METHOD_MISSING") {
          throw new Error(
            "We couldn’t process your payment method. Update your payment details to extend your stay."
          );
        }
        throw new Error(payload?.error ?? "Unable to extend stay.");
      }
      await refresh();
    } catch (err: any) {
      setFlexError(err?.message ?? "Unable to extend stay.");
    } finally {
      setFlexBusy(false);
    }
  }, [booking?.id, refresh]);

  const status = String(localStatus ?? booking?.status ?? "").toLowerCase();
  const stripeStatus = booking?.stripe_status ?? null;
  const checkIn = booking ? resolveBookingCheckIn(booking) : null;
  const checkOut = booking ? resolveBookingCheckOut(booking) : null;
  const nights = booking ? bookingNights(booking) : null;
  const isSharedGroupBooking =
    String(booking?.booking_type ?? "").toLowerCase() === "shared_group" ||
    Boolean(listing?.is_shared_stay);
  const amountMajor = booking
    ? booking.guest_total_pence != null
      ? booking.guest_total_pence / 100
      : typeof booking.price_total === "number"
      ? booking.price_total
      : 0
    : 0;

  return (
    <GuestShellLayout activeNav="trips" title="Booking detail">
      <div className="space-y-8">
        <GuestPageHeader
          title="Booking detail"
          description="View stay details, payment status, and host contact in one place."
          actions={
            booking ? (
              <Link
                href={`/guest/messages?bookingId=${encodeURIComponent(booking.id)}`}
                className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Message host
              </Link>
            ) : null
          }
        />

        {error ? (
          <Card className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
            {error}
          </Card>
        ) : null}

        {loading ? (
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading booking…
          </Card>
        ) : !booking ? (
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Booking not found.
          </Card>
        ) : (
          <>
            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Booking ref</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-slate-900">{bookingReference(booking.id)}</p>
                </div>
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName(status, stripeStatus)}`}>
                  {statusLabel(status, stripeStatus)}
                </span>
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-4">
                {isSharedGroupBooking ? (
                  <SharedBookingCard
                    listingTitle={listing?.title ?? "Shared stay"}
                    dateRangeLabel={formatDateRange(checkIn, checkOut)}
                    perPersonWeeklyPricePence={
                      listing?.shared_weekly_price_pence != null
                        ? Math.round(
                            Number(listing.shared_weekly_price_pence) /
                              Math.max(1, Math.round(Number(listing?.shared_total_spots ?? 1)))
                          )
                        : null
                    }
                    amountPaidPence={
                      booking?.guest_total_pence != null
                        ? booking.guest_total_pence
                        : booking?.price_total != null
                        ? Math.round(Number(booking.price_total) * 100)
                        : null
                    }
                    groupStatus={statusLabel(status, stripeStatus)}
                    occupancy={{
                      filled: null,
                      total: listing?.shared_total_spots ?? null,
                    }}
                  />
                ) : null}

                <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">Booking summary</h2>
                  <div className="mt-4 grid gap-3 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Property</span>
                      <span className="font-semibold text-slate-900">{listing?.title ?? "Listing"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Check-in</span>
                      <span className="font-semibold text-slate-900">{formatDate(checkIn)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Check-out</span>
                      <span className="font-semibold text-slate-900">{formatDate(checkOut)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Nights</span>
                      <span className="font-semibold text-slate-900">{nights ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Guests</span>
                      <span className="font-semibold text-slate-900">{booking.guests_total ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Status</span>
                      <span className="font-semibold text-slate-900">{statusLabel(status, stripeStatus)}</span>
                    </div>
                  </div>
                </Card>

                <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">Host</h2>
                  <div className="mt-4 flex items-center gap-3">
                    <Avatar className="h-11 w-11 border border-slate-200">
                      <AvatarImage src={host?.avatar_url ?? ""} alt={host?.full_name ?? "Host"} />
                      <AvatarFallback>
                        {(host?.full_name || host?.email || "H").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{host?.full_name ?? "Host"}</p>
                      <p className="text-xs text-slate-500">{host?.email ?? ""}</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Link
                      href={`/guest/messages?bookingId=${encodeURIComponent(booking.id)}`}
                      className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Message host
                    </Link>
                  </div>
                </Card>

                <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">Stay info</h2>
                  <div className="mt-4 space-y-4 text-sm text-slate-600">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Address</p>
                      <p className="mt-1 text-slate-900">{listing?.address ?? listing?.location ?? "Address pending"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Check-in instructions</p>
                      <p className="mt-1">{listing?.check_in_instructions ?? "Your host will share check-in instructions in messages."}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Check-out instructions</p>
                      <p className="mt-1">{listing?.check_out_instructions ?? "Follow your host’s instructions in the booking thread."}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">House rules</p>
                      <p className="mt-1">{listing?.house_rules ?? "House rules will be shared by your host."}</p>
                    </div>
                  </div>
                </Card>
              </div>

              <div className="space-y-4">
                <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">Payment summary</h2>
                  <div className="mt-4 space-y-3 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Total paid</span>
                      <span className="font-semibold text-slate-900">
                        {formatMoney(amountMajor, booking.currency ?? "GBP")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Payment status</span>
                      <span className="font-semibold text-slate-900">{statusLabel(status, stripeStatus)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Date paid</span>
                      <span className="font-semibold text-slate-900">{formatDate(booking.created_at)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Receipt</span>
                      <span className="text-xs text-slate-500">Coming soon</span>
                    </div>
                  </div>
                </Card>

                {String(booking.flex_mode ?? "").toLowerCase() === "rolling" ? (
                  <RollingFlexCard
                    enabled
                    status={booking.flex_status}
                    confirmedEnd={booking.flex_current_confirmed_end ?? checkOut}
                    maxEnd={booking.flex_max_end}
                    cutoffAt={booking.flex_extension_cutoff_at}
                    rollingWindowDays={booking.flex_rolling_window_days}
                    busy={Boolean(flexBusy)}
                    error={flexError}
                    onExtend={handleExtendRollingFlex}
                    onRelease={handleDeclineFlexNight}
                  />
                ) : (
                  <FlexStayCard
                    enabled={Boolean(booking.flex_extra_night)}
                    status={booking.flex_extra_night_status}
                    cutoffAt={booking.flex_extra_night_cutoff_at}
                    checkoutAt={checkOut}
                    pricePence={booking.flex_extra_night_price_pence}
                    busy={Boolean(flexBusy)}
                    error={flexError}
                    onConfirm={handleConfirmFlexNight}
                    onDecline={handleDeclineFlexNight}
                  />
                )}

                <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">Actions</h2>
                  <div className="mt-4 space-y-2">
                    <Link
                      href={`/guest/messages?bookingId=${encodeURIComponent(booking.id)}`}
                      className="inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Message host
                    </Link>

                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {copyState === "done" ? "Address copied" : copyState === "error" ? "Copy failed" : "Copy address"}
                    </button>

                    {canGuestCancel(status, stripeStatus) ? (
                      <button
                        type="button"
                        disabled={canceling}
                        onClick={handleCancelBooking}
                        className="inline-flex w-full items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                      >
                        {canceling ? "Cancelling…" : "Cancel booking"}
                      </button>
                    ) : null}

                    {reviewLoading ? (
                      <p className="text-xs text-slate-500">Checking review eligibility…</p>
                    ) : reviewEligibility?.guestAlreadyReviewed ? (
                      <p className="text-xs font-semibold text-emerald-700">Review submitted</p>
                    ) : reviewEligibility?.canGuestReview ? (
                      <button
                        type="button"
                        onClick={() => setReviewModalOpen(true)}
                        className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Leave review
                      </button>
                    ) : null}
                  </div>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>

      {booking ? (
        <ReviewFormModal
          open={reviewModalOpen}
          onOpenChange={setReviewModalOpen}
          bookingId={booking.id}
          mode="guest_to_host"
          subjectLabel={listing?.title ?? "your stay"}
          onSubmitted={() => {
            loadReviewEligibility().catch(() => null);
          }}
        />
      ) : null}
    </GuestShellLayout>
  );
}
