import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { buildReviewSummary, type ReviewCategoryKey } from "@/lib/reviews";

const REVIEW_KEYS: ReviewCategoryKey[] = [
  "cleanliness",
  "accuracy",
  "comfort",
  "location",
  "value",
  "host",
];

const isValidScore = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10;

const parseScore = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const allowedStatuses = new Set(["paid", "approved", "confirmed"]);

type ReviewPayload = {
  bookingId: string;
  listingId: string;
  reviewerId: string;
  reviewerRole: "guest" | "host";
  ratings: Record<ReviewCategoryKey, number>;
  comment?: string | null;
};

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

async function updateListingSummary(
  listingId: string,
  supabase: ReturnType<typeof getSupabaseServerClient>
) {
  const { data: rows, error } = await supabase
    .from("listing_reviews")
    .select("cleanliness, accuracy, comfort, location, value, host")
    .eq("listing_id", listingId)
    .eq("is_published", true)
    .eq("reviewer_role", "guest");

  if (error) {
    console.error("[api/reviews] failed to load reviews for summary", error);
    return;
  }

  const published = Array.isArray(rows) ? rows : [];
  if (published.length === 0) {
    const { error: updateError } = await supabase
      .from("listings")
      .update({ review_overall: null, review_total: 0 })
      .eq("id", listingId);
    if (updateError) {
      console.warn("[api/reviews] unable to clear listing review summary", updateError);
    }
    return;
  }

  const averages = computeAverages(published as Array<Record<ReviewCategoryKey, number>>);
  const summary = buildReviewSummary(averages, published.length);
  const { error: updateError } = await supabase
    .from("listings")
    .update({ review_overall: summary.overall, review_total: summary.total })
    .eq("id", listingId);

  if (updateError) {
    console.warn("[api/reviews] unable to update listing review summary", updateError);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabaseServerClient();
  const body = req.body as Partial<ReviewPayload>;

  const bookingId = body.bookingId?.trim();
  const listingId = body.listingId?.trim();
  const reviewerId = body.reviewerId?.trim();
  const reviewerRole = body.reviewerRole;
  const ratings = body.ratings as Record<ReviewCategoryKey, number> | undefined;
  const commentRaw = typeof body.comment === "string" ? body.comment.trim() : null;
  const comment = commentRaw && commentRaw.length > 0 ? commentRaw.slice(0, 500) : null;

  if (!bookingId || !listingId || !reviewerId || !reviewerRole) {
    return res.status(400).json({ error: "Missing required review fields." });
  }

  if (reviewerRole !== "guest" && reviewerRole !== "host") {
    return res.status(400).json({ error: "Invalid reviewer role." });
  }

  if (!ratings) {
    return res.status(400).json({ error: "Ratings are required." });
  }

  for (const key of REVIEW_KEYS) {
    if (!isValidScore((ratings as any)[key])) {
      return res.status(400).json({ error: `Invalid score for ${key}.` });
    }
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, listing_id, guest_id, host_id, status, check_out_time")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error("[api/reviews] booking lookup failed", bookingError);
    return res.status(500).json({ error: "Unable to load booking." });
  }

  if (!booking) {
    return res.status(404).json({ error: "Booking not found." });
  }

  if (booking.listing_id !== listingId) {
    return res.status(400).json({ error: "Listing does not match booking." });
  }

  const expectedReviewerId = reviewerRole === "guest" ? booking.guest_id : booking.host_id;
  if (!expectedReviewerId || expectedReviewerId !== reviewerId) {
    return res.status(403).json({ error: "Reviewer does not match booking." });
  }

  if (!booking.status || !allowedStatuses.has(booking.status)) {
    return res.status(400).json({ error: "Review allowed only after a completed booking." });
  }

  const checkout = booking.check_out_time ? new Date(booking.check_out_time) : null;
  if (!checkout || Number.isNaN(checkout.getTime()) || checkout.getTime() > Date.now()) {
    return res.status(400).json({ error: "Review allowed only after checkout." });
  }

  const { data: existing } = await supabase
    .from("listing_reviews")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("reviewer_role", reviewerRole)
    .maybeSingle();

  if (existing?.id) {
    return res.status(409).json({ error: "Review already submitted for this booking." });
  }

  const insertPayload = {
    booking_id: bookingId,
    listing_id: listingId,
    reviewer_id: reviewerId,
    reviewer_role: reviewerRole,
    cleanliness: parseScore(ratings.cleanliness),
    accuracy: parseScore(ratings.accuracy),
    comfort: parseScore(ratings.comfort),
    location: parseScore(ratings.location),
    value: parseScore(ratings.value),
    host: parseScore(ratings.host),
    comment,
    is_published: false,
  };

  const { data: created, error: insertError } = await supabase
    .from("listing_reviews")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError) {
    console.error("[api/reviews] failed to create review", insertError);
    return res.status(500).json({ error: insertError.message });
  }

  let published = false;
  const counterpartRole = reviewerRole === "guest" ? "host" : "guest";
  const { data: counterpart } = await supabase
    .from("listing_reviews")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("reviewer_role", counterpartRole)
    .maybeSingle();

  if (counterpart?.id) {
    const publishAt = new Date().toISOString();
    const { error: publishError } = await supabase
      .from("listing_reviews")
      .update({ is_published: true, published_at: publishAt })
      .in("id", [created.id, counterpart.id]);

    if (publishError) {
      console.error("[api/reviews] failed to publish reviews", publishError);
    } else {
      published = true;
      await updateListingSummary(listingId, supabase);
    }
  }

  return res.status(201).json({ review: { id: created.id, published } });
}
