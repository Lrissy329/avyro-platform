import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  buildReviewSummary,
  type ReviewCategoryKey
} from "@/lib/reviews";
import {
  computeListingSummaryFromRows,
  getPublishedGuestReviewsForListing,
  publishExpiredReviews,
  toListingPublicReviews,
  type ListingPublicReview,
  type ListingReviewSummary,
  type ReviewRequestError,
  isMissingTableError,
} from "@/lib/reviewSystem";

const buildEmptySummary = () =>
  buildReviewSummary(
    {
      cleanliness: 0,
      accuracy: 0,
      communication: 0,
      location: 0,
      value: 0,
    },
    0
  );

const asNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
};

const mapNewSummaryToLegacyScores = (summary: ListingReviewSummary): Record<ReviewCategoryKey, number> => ({
  cleanliness: summary.averages.cleanliness,
  accuracy: summary.averages.accuracy,
  communication: summary.averages.communication,
  location: summary.averages.location,
  value: summary.averages.value,
});

const legacyPublicReviews = (reviews: ListingPublicReview[]) =>
  reviews.map((review) => ({
    id: review.id,
    reviewer_id: review.reviewerId,
    comment: review.publicComment,
    created_at: review.createdAt,
    published_at: review.publishedAt,
    overall: review.overallScore,
  }));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const listingId = typeof req.query.id === "string" ? req.query.id : null;
  if (!listingId) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  const supabase = getSupabaseServerClient();

  try {
    await publishExpiredReviews(supabase);
    const newRows = await getPublishedGuestReviewsForListing(supabase, listingId);
    if (newRows.length > 0) {
      const newSummary = computeListingSummaryFromRows(newRows);
      const summary = buildReviewSummary(
        mapNewSummaryToLegacyScores(newSummary),
        newSummary.count
      );
      const reviews = legacyPublicReviews(await toListingPublicReviews(supabase, newRows));
      return res.status(200).json({
        listing_id: listingId,
        summary,
        reviews,
      });
    }

    const { data: rows, error } = await supabase
      .from("listing_reviews")
      .select(
        "id, reviewer_id, comment, created_at, published_at, cleanliness, accuracy, comfort, location, value, host"
      )
      .eq("listing_id", listingId)
      .eq("reviewer_role", "guest")
      .eq("is_published", true)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        return res.status(200).json({
          listing_id: listingId,
          summary: buildEmptySummary(),
          reviews: [],
        });
      }
      console.error("[api/listings/reviews] failed to load reviews", error);
      return res.status(500).json({ error: "Unable to load reviews" });
    }

    const reviews = Array.isArray(rows) ? rows : [];
    if (reviews.length === 0) {
      return res.status(200).json({
        listing_id: listingId,
        summary: buildEmptySummary(),
        reviews: [],
      });
    }

    const mappedScores = reviews.map((row) => ({
      cleanliness: asNumber((row as any).cleanliness),
      accuracy: asNumber((row as any).accuracy),
      communication: asNumber((row as any).host),
      location: asNumber((row as any).location),
      value: asNumber((row as any).value),
    }));
    const count = mappedScores.length;
    const totals = mappedScores.reduce(
      (acc, score) => {
        acc.cleanliness += score.cleanliness;
        acc.accuracy += score.accuracy;
        acc.communication += score.communication;
        acc.location += score.location;
        acc.value += score.value;
        return acc;
      },
      { cleanliness: 0, accuracy: 0, communication: 0, location: 0, value: 0 }
    );
    const summary = buildReviewSummary(
      {
        cleanliness: totals.cleanliness / count,
        accuracy: totals.accuracy / count,
        communication: totals.communication / count,
        location: totals.location / count,
        value: totals.value / count,
      },
      count
    );

    return res.status(200).json({
      listing_id: listingId,
      summary,
      reviews: reviews.map((row) => ({
        id: row.id,
        reviewer_id: row.reviewer_id,
        comment: row.comment ?? null,
        created_at: row.created_at,
        published_at: row.published_at,
        overall: null,
      })),
    });
  } catch (error: any) {
    const maybeReviewError = error as ReviewRequestError;
    if (typeof maybeReviewError?.status === "number") {
      return res.status(maybeReviewError.status).json({
        error: maybeReviewError.message,
        code: (maybeReviewError as any).code ?? null,
      });
    }
    console.error("[api/listings/reviews] unexpected error", error);
    return res.status(500).json({ error: "Unable to load listing reviews" });
  }
}
