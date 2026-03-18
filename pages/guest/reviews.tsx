import { useCallback, useEffect, useMemo, useState } from "react";

import { GuestPageHeader } from "@/components/guest/GuestPageHeader";
import { GuestShellLayout } from "@/components/guest/GuestShellLayout";
import {
  formatDate,
  groupGuestBookings,
  resolveBookingCheckIn,
  resolveBookingCheckOut,
  type GuestBookingRecord,
  type ReviewEligibility,
} from "@/components/guest/bookingUtils";
import { ReviewFormModal } from "@/components/reviews/ReviewFormModal";
import { Card } from "@/components/ui/card";
import { useGuestBookingsData } from "@/hooks/useGuestBookingsData";
import { supabase } from "@/lib/supabaseClient";

type SubmittedGuestReview = {
  id: string;
  booking_id: string;
  overall_score: number;
  public_comment: string | null;
  created_at: string | null;
  is_published: boolean;
};

const isMissingTableError = (error: any) => {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42p01" || message.includes("relation") || message.includes("reviews");
};

export default function GuestReviewsPage() {
  const { loading, error, userId, bookings, listingById } = useGuestBookingsData();

  const [reviewEligibilityByBooking, setReviewEligibilityByBooking] = useState<
    Record<string, ReviewEligibility>
  >({});
  const [reviewEligibilityLoadingByBooking, setReviewEligibilityLoadingByBooking] = useState<
    Record<string, boolean>
  >({});
  const [submittedReviews, setSubmittedReviews] = useState<SubmittedGuestReview[]>([]);
  const [submittedLoading, setSubmittedLoading] = useState(false);
  const [reviewModalBooking, setReviewModalBooking] = useState<GuestBookingRecord | null>(null);

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
        throw new Error(payload?.error ?? "Unable to load review eligibility.");
      }

      const eligibility = payload as ReviewEligibility;
      setReviewEligibilityByBooking((prev) => ({ ...prev, [bookingId]: eligibility }));
      return eligibility;
    } catch (err) {
      console.error("[guest reviews] review eligibility failed", err);
      return null;
    } finally {
      setReviewEligibilityLoadingByBooking((prev) => ({ ...prev, [bookingId]: false }));
    }
  }, []);

  const loadSubmittedReviews = useCallback(async () => {
    if (!userId) return;
    setSubmittedLoading(true);

    try {
      const { data, error: queryError } = await supabase
        .from("reviews")
        .select("id, booking_id, overall_score, public_comment, created_at, is_published")
        .eq("reviewer_id", userId)
        .eq("review_type", "guest_to_host")
        .order("created_at", { ascending: false });

      if (queryError) {
        if (isMissingTableError(queryError)) {
          setSubmittedReviews([]);
          return;
        }
        throw queryError;
      }

      setSubmittedReviews((Array.isArray(data) ? data : []) as SubmittedGuestReview[]);
    } catch (err) {
      console.error("[guest reviews] failed to load submitted reviews", err);
      setSubmittedReviews([]);
    } finally {
      setSubmittedLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (buckets.past.length === 0) return;

    buckets.past.forEach((booking) => {
      if (!reviewEligibilityByBooking[booking.id] && !reviewEligibilityLoadingByBooking[booking.id]) {
        fetchReviewEligibility(booking.id).catch(() => null);
      }
    });
  }, [buckets.past, reviewEligibilityByBooking, reviewEligibilityLoadingByBooking, fetchReviewEligibility]);

  useEffect(() => {
    loadSubmittedReviews().catch(() => null);
  }, [loadSubmittedReviews]);

  const pendingReviews = useMemo(
    () => buckets.past.filter((booking) => reviewEligibilityByBooking[booking.id]?.canGuestReview),
    [buckets.past, reviewEligibilityByBooking]
  );

  const bookingById = useMemo(
    () =>
      bookings.reduce<Record<string, GuestBookingRecord>>((acc, booking) => {
        acc[booking.id] = booking;
        return acc;
      }, {}),
    [bookings]
  );

  return (
    <GuestShellLayout activeNav="reviews" title="Reviews">
      <div className="space-y-8">
        <GuestPageHeader
          title="Reviews"
          description="Leave reviews for completed stays and track what you’ve already submitted."
        />

        {error ? (
          <Card className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
            {error}
          </Card>
        ) : null}

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Reviews pending</h2>
          {loading ? (
            <Card className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              Checking eligible stays…
            </Card>
          ) : pendingReviews.length === 0 ? (
            <Card className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              No reviews pending right now.
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingReviews.map((booking) => {
                const listing = listingById[booking.listing_id];
                return (
                  <Card
                    key={booking.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{listing?.title ?? "Listing"}</p>
                        <p className="text-sm text-slate-500">
                          {formatDate(resolveBookingCheckIn(booking))} → {formatDate(resolveBookingCheckOut(booking))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReviewModalBooking(booking)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Leave review
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Reviews submitted</h2>
          {submittedLoading ? (
            <Card className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              Loading submitted reviews…
            </Card>
          ) : submittedReviews.length === 0 ? (
            <Card className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              You haven’t submitted any reviews yet.
            </Card>
          ) : (
            <div className="space-y-3">
              {submittedReviews.map((review) => {
                const booking = bookingById[review.booking_id];
                const listing = booking ? listingById[booking.listing_id] : null;

                return (
                  <Card key={review.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{listing?.title ?? "Listing"}</p>
                        <p className="text-sm text-slate-500">
                          {review.created_at ? formatDate(review.created_at) : "Recent stay"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900">{review.overall_score}/10</p>
                        <p className="text-xs text-slate-500">
                          {review.is_published ? "Published" : "Waiting for publication"}
                        </p>
                      </div>
                    </div>
                    {review.public_comment ? (
                      <p className="mt-3 text-sm text-slate-700">{review.public_comment}</p>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </section>
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
            loadSubmittedReviews().catch(() => null);
          }}
        />
      ) : null}
    </GuestShellLayout>
  );
}
