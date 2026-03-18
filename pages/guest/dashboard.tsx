import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import { GuestNextActionBanner, type NextAction } from "@/components/guest/GuestNextActionBanner";
import { GuestPageHeader } from "@/components/guest/GuestPageHeader";
import { GuestShellLayout } from "@/components/guest/GuestShellLayout";
import { GuestStayCard } from "@/components/guest/GuestStayCard";
import { GuestTripsSection } from "@/components/guest/GuestTripsSection";
import {
  groupGuestBookings,
  isAwaitingPayment,
  parseIsoDate,
  resolveBookingCheckIn,
  resolveBookingCheckOut,
  type GuestBookingRecord,
  type ReviewEligibility,
} from "@/components/guest/bookingUtils";
import { ReviewFormModal } from "@/components/reviews/ReviewFormModal";
import { Button } from "@/components/ui/button";
import { useGuestBookingsData } from "@/hooks/useGuestBookingsData";

const daysUntil = (iso?: string | null) => {
  const date = parseIsoDate(iso);
  if (!date) return Number.POSITIVE_INFINITY;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfDate.getTime() - startOfToday.getTime()) / 86400000);
};

export default function GuestDashboardTripsPage() {
  const router = useRouter();
  const { loading, error, bookings, listingById, hostById } = useGuestBookingsData();

  const [reviewEligibilityByBooking, setReviewEligibilityByBooking] = useState<
    Record<string, ReviewEligibility>
  >({});
  const [reviewEligibilityLoadingByBooking, setReviewEligibilityLoadingByBooking] = useState<
    Record<string, boolean>
  >({});
  const [reviewModalBooking, setReviewModalBooking] = useState<GuestBookingRecord | null>(null);
  const [showAllPast, setShowAllPast] = useState(false);

  const buckets = useMemo(() => groupGuestBookings(bookings), [bookings]);

  const fetchReviewEligibility = useCallback(async (bookingId: string) => {
    if (!bookingId) return null;
    setReviewEligibilityLoadingByBooking((prev) => ({ ...prev, [bookingId]: true }));

    try {
      const response = await fetch(
        `/api/reviews/eligibility?bookingId=${encodeURIComponent(bookingId)}`
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to check review eligibility.");
      }

      const eligibility = payload as ReviewEligibility;
      setReviewEligibilityByBooking((prev) => ({ ...prev, [bookingId]: eligibility }));
      return eligibility;
    } catch (err) {
      console.error("[guest trips] review eligibility failed", err);
      return null;
    } finally {
      setReviewEligibilityLoadingByBooking((prev) => ({ ...prev, [bookingId]: false }));
    }
  }, []);

  useEffect(() => {
    if (buckets.past.length === 0) return;

    buckets.past.forEach((booking) => {
      if (!reviewEligibilityByBooking[booking.id] && !reviewEligibilityLoadingByBooking[booking.id]) {
        fetchReviewEligibility(booking.id).catch(() => null);
      }
    });
  }, [buckets.past, reviewEligibilityByBooking, reviewEligibilityLoadingByBooking, fetchReviewEligibility]);

  const nextAction = useMemo<NextAction>(() => {
    const awaitingPaymentBooking = bookings.find((booking) => isAwaitingPayment(booking.status));
    if (awaitingPaymentBooking) {
      return {
        title: "Your booking is awaiting payment confirmation",
        description: "Complete payment to secure your stay and unlock check-in details.",
        buttons: [
          { label: "View booking", href: `/guest/bookings/${awaitingPaymentBooking.id}` },
          {
            label: "Message host",
            href: `/guest/messages?bookingId=${encodeURIComponent(awaitingPaymentBooking.id)}`,
            tone: "secondary",
          },
        ],
      };
    }

    const currentBooking = buckets.current[0];
    if (currentBooking) {
      const listing = listingById[currentBooking.listing_id];
      return {
        title: `You're currently staying at ${listing?.title ?? "your booking"}`,
        description: "Check your booking details or contact your host if you need anything.",
        buttons: [
          { label: "View booking", href: `/guest/bookings/${currentBooking.id}` },
          {
            label: "Message host",
            href: `/guest/messages?bookingId=${encodeURIComponent(currentBooking.id)}`,
            tone: "secondary",
          },
        ],
      };
    }

    const upcomingSoon = buckets.upcoming.find((booking) => daysUntil(resolveBookingCheckIn(booking)) <= 1);
    if (upcomingSoon) {
      const inDays = daysUntil(resolveBookingCheckIn(upcomingSoon));
      const title = inDays <= 0 ? "Check-in is today" : "Your stay starts tomorrow";
      return {
        title,
        description: "Message your host if you need arrival details or access instructions.",
        buttons: [
          {
            label: "Message host",
            href: `/guest/messages?bookingId=${encodeURIComponent(upcomingSoon.id)}`,
          },
          {
            label: "View booking",
            href: `/guest/bookings/${upcomingSoon.id}`,
            tone: "secondary",
          },
        ],
      };
    }

    const reviewPendingBooking = buckets.past.find(
      (booking) => reviewEligibilityByBooking[booking.id]?.canGuestReview
    );

    if (reviewPendingBooking) {
      return {
        title: "Leave a review for your recent stay",
        description: "Help other professionals know what to expect.",
        buttons: [
          {
            label: "Leave review",
            onClick: () => setReviewModalBooking(reviewPendingBooking),
          },
        ],
      };
    }

    if (bookings.length === 0) {
      return {
        title: "No trips booked yet",
        description: "Browse stays near Stansted and book your next stay.",
        buttons: [{ label: "Browse stays", href: "/search" }],
      };
    }

    const nextUpcoming = buckets.upcoming[0];
    if (nextUpcoming) {
      return {
        title: "Your next stay is coming up",
        description: "Open your booking to check key details and message your host.",
        buttons: [
          { label: "View booking", href: `/guest/bookings/${nextUpcoming.id}` },
          {
            label: "Message host",
            href: `/guest/messages?bookingId=${encodeURIComponent(nextUpcoming.id)}`,
            tone: "secondary",
          },
        ],
      };
    }

    return {
      title: "Trips overview",
      description: "Manage your stays, booking details, and host messages from here.",
      buttons: [{ label: "Browse stays", href: "/search" }],
    };
  }, [bookings, buckets, listingById, reviewEligibilityByBooking]);

  const visiblePast = useMemo(
    () => (showAllPast ? buckets.past : buckets.past.slice(0, 4)),
    [buckets.past, showAllPast]
  );

  return (
    <GuestShellLayout activeNav="trips" title="Trips">
      <div className="space-y-8">
        <GuestPageHeader
          title="Trips"
          description="Manage your stays, view booking details, and message hosts."
        />

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </section>
        ) : null}

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading your trips…
          </section>
        ) : (
          <>
            <GuestNextActionBanner action={nextAction} />

            {buckets.current.length > 0 ? (
              <GuestTripsSection
                title="Current stay"
                description="You're checked in right now."
              >
                <div className="space-y-4">
                  {buckets.current.map((booking) => (
                    <GuestStayCard
                      key={booking.id}
                      booking={booking}
                      listing={listingById[booking.listing_id] ?? null}
                      host={booking.host_id ? hostById[booking.host_id] ?? null : null}
                      mode="current"
                    />
                  ))}
                </div>
              </GuestTripsSection>
            ) : null}

            <GuestTripsSection
              title="Upcoming stays"
              description="Your upcoming bookings and quick actions."
              emptyTitle="No upcoming stays yet."
              emptyDescription="You don’t have any bookings yet."
              emptyActionLabel="Browse stays"
              onEmptyAction={() => router.push("/search")}
            >
              {buckets.upcoming.length > 0 ? (
                <div className="space-y-4">
                  {buckets.upcoming.map((booking) => (
                    <GuestStayCard
                      key={booking.id}
                      booking={booking}
                      listing={listingById[booking.listing_id] ?? null}
                      host={booking.host_id ? hostById[booking.host_id] ?? null : null}
                      mode="upcoming"
                    />
                  ))}
                </div>
              ) : null}
            </GuestTripsSection>

            <GuestTripsSection
              title="Past stays"
              description="Previous stays and review status."
              collapsed
              actionSlot={
                buckets.past.length > 4 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => setShowAllPast((prev) => !prev)}
                  >
                    {showAllPast ? "Show fewer" : `Show all (${buckets.past.length})`}
                  </Button>
                ) : null
              }
            >
              {visiblePast.length > 0 ? (
                <div className="space-y-3">
                  {visiblePast.map((booking) => (
                    <GuestStayCard
                      key={booking.id}
                      booking={booking}
                      listing={listingById[booking.listing_id] ?? null}
                      host={booking.host_id ? hostById[booking.host_id] ?? null : null}
                      mode="past"
                      reviewEligibility={reviewEligibilityByBooking[booking.id] ?? null}
                      reviewEligibilityLoading={Boolean(reviewEligibilityLoadingByBooking[booking.id])}
                      onLeaveReview={() => setReviewModalBooking(booking)}
                    />
                  ))}
                </div>
              ) : null}
            </GuestTripsSection>
          </>
        )}
      </div>

      {reviewModalBooking ? (
        <ReviewFormModal
          open={Boolean(reviewModalBooking)}
          onOpenChange={(open) => {
            if (!open) setReviewModalBooking(null);
          }}
          bookingId={reviewModalBooking.id}
          mode="guest_to_host"
          subjectLabel={listingById[reviewModalBooking.listing_id]?.title ?? "your stay"}
          onSubmitted={() => {
            fetchReviewEligibility(reviewModalBooking.id).catch(() => null);
          }}
        />
      ) : null}
    </GuestShellLayout>
  );
}
