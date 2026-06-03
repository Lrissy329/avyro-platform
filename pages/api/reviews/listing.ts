import type { NextApiRequest, NextApiResponse } from "next";

import { computeOverallScore } from "@/lib/reviews";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  computeListingSummaryFromRows,
  getPublishedGuestReviewsForListing,
  isMissingTableError,
  publishExpiredReviews,
  ReviewRequestError,
  toListingPublicReviews,
  type ListingReviewSummary,
  type ListingPublicReview,
} from "@/lib/reviewSystem";

const ENABLE_SHARED_LISTING_DETAIL_DEBUG =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEBUG_SHARED_LISTING_DETAIL === "1";

const debugLog = (payload: Record<string, unknown>) => {
  if (!ENABLE_SHARED_LISTING_DETAIL_DEBUG) return;
  console.log(`SHARED_LISTING_DETAIL_DEBUG\n${JSON.stringify(payload, null, 2)}`);
};

type LegacyListingReviewRow = {
  id: string;
  reviewer_id: string | null;
  comment: string | null;
  created_at: string | null;
  published_at: string | null;
  cleanliness: number | null;
  accuracy: number | null;
  comfort: number | null;
  location: number | null;
  value: number | null;
  host: number | null;
};

const emptySummary = (): ListingReviewSummary => ({
  count: 0,
  averages: {
    overall: 0,
    accuracy: 0,
    cleanliness: 0,
    communication: 0,
    checkin: 0,
    noise: 0,
    transport: 0,
    value: 0,
  },
  wouldStayAgainPct: null,
});

const roundOne = (value: number) => Number(value.toFixed(1));

const asNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
};

async function getLegacyPublishedListingReviews(
  listingId: string
): Promise<{ summary: ListingReviewSummary; reviews: ListingPublicReview[] } | null> {
  const admin = getSupabaseServerClient();
  const { data, error } = await admin
    .from("listing_reviews")
    .select(
      "id, reviewer_id, comment, created_at, published_at, cleanliness, accuracy, comfort, location, value, host"
    )
    .eq("listing_id", listingId)
    .eq("reviewer_role", "guest")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return null;
    throw new ReviewRequestError(500, error.message || "Unable to load legacy listing reviews.");
  }

  const rows = (Array.isArray(data) ? data : []) as LegacyListingReviewRow[];
  if (!rows.length) return null;

  const totals = {
    overall: 0,
    accuracy: 0,
    cleanliness: 0,
    communication: 0,
    checkin: 0,
    noise: 0,
    transport: 0,
    value: 0,
  };

  rows.forEach((row) => {
    const mapped = {
      cleanliness: asNumber(row.cleanliness),
      accuracy: asNumber(row.accuracy),
      comfort: asNumber(row.comfort),
      location: asNumber(row.location),
      value: asNumber(row.value),
      host: asNumber(row.host),
    };
    totals.overall += computeOverallScore(mapped);
    totals.accuracy += mapped.accuracy;
    totals.cleanliness += mapped.cleanliness;
    totals.communication += mapped.host;
    totals.checkin += mapped.host;
    totals.noise += mapped.comfort;
    totals.transport += mapped.location;
    totals.value += mapped.value;
  });

  const count = rows.length;
  const summary: ListingReviewSummary = {
    count,
    averages: {
      overall: roundOne(totals.overall / count),
      accuracy: roundOne(totals.accuracy / count),
      cleanliness: roundOne(totals.cleanliness / count),
      communication: roundOne(totals.communication / count),
      checkin: roundOne(totals.checkin / count),
      noise: roundOne(totals.noise / count),
      transport: roundOne(totals.transport / count),
      value: roundOne(totals.value / count),
    },
    wouldStayAgainPct: null,
  };

  const reviewerIds = Array.from(
    new Set(rows.map((row) => row.reviewer_id).filter((id): id is string => Boolean(id)))
  );
  const nameMap: Record<string, string | null> = {};

  if (reviewerIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", reviewerIds);
    (Array.isArray(profiles) ? profiles : []).forEach((profile: any) => {
      if (typeof profile?.id !== "string") return;
      nameMap[profile.id] =
        typeof profile?.full_name === "string" ? profile.full_name.split(" ").slice(0, 1).join(" ") : null;
    });
  }

  const reviews: ListingPublicReview[] = rows.map((row) => ({
    id: row.id,
    bookingId: "",
    reviewerId: row.reviewer_id ?? "",
    reviewerName: row.reviewer_id ? nameMap[row.reviewer_id] ?? null : null,
    overallScore: computeOverallScore({
      cleanliness: asNumber(row.cleanliness),
      accuracy: asNumber(row.accuracy),
      comfort: asNumber(row.comfort),
      location: asNumber(row.location),
      value: asNumber(row.value),
      host: asNumber(row.host),
    }),
    publicComment: typeof row.comment === "string" && row.comment.trim() ? row.comment.trim() : null,
    createdAt: row.created_at ?? null,
    publishedAt: row.published_at ?? null,
  }));

  return { summary, reviews };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const listingId =
    typeof req.query.listingId === "string"
      ? req.query.listingId.trim()
      : typeof req.query.id === "string"
      ? req.query.id.trim()
      : "";

  if (!listingId) {
    return res.status(400).json({ error: "listingId is required." });
  }

  const admin = getSupabaseServerClient();

  try {
    await publishExpiredReviews(admin);
    const rows = await getPublishedGuestReviewsForListing(admin, listingId);
    debugLog({
      listing_id: listingId,
      stage: "reviews_loaded",
      review_rows: rows.length,
    });

    if (rows.length > 0) {
      const summary = computeListingSummaryFromRows(rows);
      const reviews = await toListingPublicReviews(admin, rows);
      return res.status(200).json({
        listingId,
        summary,
        reviews,
      });
    }

    const legacy = await getLegacyPublishedListingReviews(listingId);
    if (legacy) {
      return res.status(200).json({
        listingId,
        summary: legacy.summary,
        reviews: legacy.reviews,
      });
    }

    return res.status(200).json({
      listingId,
      summary: emptySummary(),
      reviews: [],
    });
  } catch (error: any) {
    debugLog({
      listing_id: listingId,
      stage: "reviews_failed",
      error_message: error?.message ?? null,
      error_code: error?.code ?? null,
    });
    if (error instanceof ReviewRequestError) {
      if (error.code === "REVIEWS_TABLE_MISSING") {
        return res.status(200).json({
          listingId,
          summary: emptySummary(),
          reviews: [],
        });
      }
      return res.status(error.status).json({
        error: error.message,
        code: error.code ?? null,
      });
    }
    console.error("[api/reviews/listing] unexpected error", error);
    return res.status(500).json({ error: "Unable to load listing reviews." });
  }
}
