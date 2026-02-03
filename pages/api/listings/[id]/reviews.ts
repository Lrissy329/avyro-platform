import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  buildReviewSummary,
  computeOverallScore,
  type ReviewCategoryKey,
} from "@/lib/reviews";

const REVIEW_KEYS: ReviewCategoryKey[] = [
  "cleanliness",
  "accuracy",
  "comfort",
  "location",
  "value",
  "host",
];

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const computeAverages = (rows: Array<Record<ReviewCategoryKey, number>>) => {
  const totals = REVIEW_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<ReviewCategoryKey, number>);

  rows.forEach((row) => {
    REVIEW_KEYS.forEach((key) => {
      totals[key] += row[key];
    });
  });

  const count = rows.length || 1;
  return REVIEW_KEYS.reduce((acc, key) => {
    acc[key] = totals[key] / count;
    return acc;
  }, {} as Record<ReviewCategoryKey, number>);
};

const buildEmptySummary = () =>
  buildReviewSummary(
    {
      cleanliness: 0,
      accuracy: 0,
      comfort: 0,
      location: 0,
      value: 0,
      host: 0,
    },
    0
  );

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const listingId = typeof req.query.id === "string" ? req.query.id : null;
  if (!listingId) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  const supabase = getSupabaseServerClient();

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

  const normalized = reviews.map((row) => {
    const scores = REVIEW_KEYS.reduce((acc, key) => {
      acc[key] = toNumber((row as any)[key]) ?? 0;
      return acc;
    }, {} as Record<ReviewCategoryKey, number>);
    const overall = computeOverallScore(scores);
    return {
      id: row.id,
      reviewer_id: row.reviewer_id,
      comment: row.comment ?? null,
      created_at: row.created_at,
      published_at: row.published_at,
      overall,
    };
  });

  const averages = computeAverages(
    reviews.map((row) =>
      REVIEW_KEYS.reduce((acc, key) => {
        acc[key] = toNumber((row as any)[key]) ?? 0;
        return acc;
      }, {} as Record<ReviewCategoryKey, number>)
    )
  );
  const summary = buildReviewSummary(averages, reviews.length);

  return res.status(200).json({
    listing_id: listingId,
    summary,
    reviews: normalized,
  });
}
