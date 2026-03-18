import type { SupabaseClient } from "@supabase/supabase-js";

export const REVIEW_WINDOW_DAYS = 14;

export type ReviewerRole = "guest" | "host";
export type ReviewType = "guest_to_host" | "host_to_guest";

export type ReviewEligibility = {
  canGuestReview: boolean;
  canHostReview: boolean;
  guestAlreadyReviewed: boolean;
  hostAlreadyReviewed: boolean;
  reviewWindowExpiresAt: string | null;
};

export type ListingReviewAverages = {
  overall: number;
  accuracy: number;
  cleanliness: number;
  communication: number;
  checkin: number;
  noise: number;
  transport: number;
  value: number;
};

export type ListingReviewSummary = {
  count: number;
  averages: ListingReviewAverages;
  wouldStayAgainPct: number | null;
};

export type ListingPublicReview = {
  id: string;
  bookingId: string;
  reviewerId: string;
  reviewerName: string | null;
  overallScore: number;
  publicComment: string | null;
  createdAt: string | null;
  publishedAt: string | null;
};

type ReviewRow = {
  id: string;
  booking_id: string;
  reviewer_id: string;
  reviewer_role: ReviewerRole;
  review_type: ReviewType;
  reviewee_id: string;
  overall_score: number | null;
  accuracy_score: number | null;
  cleanliness_score: number | null;
  communication_score: number | null;
  checkin_score: number | null;
  noise_score: number | null;
  transport_score: number | null;
  value_score: number | null;
  rules_score: number | null;
  punctuality_score: number | null;
  would_stay_again: boolean | null;
  would_host_again: boolean | null;
  public_comment: string | null;
  private_note: string | null;
  is_published: boolean;
  review_window_expires_at: string;
  published_at: string | null;
  created_at: string | null;
};

export type BookingForReview = {
  id: string;
  listing_id: string | null;
  guest_id: string | null;
  host_id: string | null;
  status: string | null;
  check_out_time?: string | null;
  check_out?: string | null;
  completed_at?: string | null;
};

export type CreateReviewInput = {
  bookingId: string;
  reviewType: ReviewType;
  overallScore: number;
  accuracyScore?: number;
  cleanlinessScore?: number;
  communicationScore?: number;
  checkinScore?: number;
  noiseScore?: number;
  transportScore?: number;
  valueScore?: number;
  rulesScore?: number;
  punctualityScore?: number;
  wouldStayAgain?: boolean;
  wouldHostAgain?: boolean;
  publicComment?: string;
  privateNote?: string;
};

export class ReviewRequestError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const REVIEW_COMPLETE_STATUSES = new Set(["completed", "paid", "confirmed"]);
const SCORE_MIN = 1;
const SCORE_MAX = 10;
const PUBLIC_COMMENT_MAX = 1200;
const PRIVATE_NOTE_MAX = 2000;

const zeroAverages = (): ListingReviewAverages => ({
  overall: 0,
  accuracy: 0,
  cleanliness: 0,
  communication: 0,
  checkin: 0,
  noise: 0,
  transport: 0,
  value: 0,
});

const roundOne = (value: number) => Number(value.toFixed(1));

const isIntegerScore = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= SCORE_MIN &&
  value <= SCORE_MAX;

const parseScore = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const sanitizeOptionalText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

export const isMissingColumnError = (error: any) => {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "pgrst204" || message.includes("schema cache");
};

export const isMissingTableError = (error: any) => {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42p01" || message.includes("relation") || message.includes("reviews");
};

export async function fetchBookingForReview(
  supabase: SupabaseClient,
  bookingId: string
): Promise<BookingForReview | null> {
  const selects = [
    "id, listing_id, guest_id, host_id, status, check_out_time, check_out, completed_at",
    "id, listing_id, guest_id, host_id, status, check_out_time, check_out",
    "id, listing_id, guest_id, host_id, status, check_out_time",
    "id, listing_id, guest_id, host_id, status, check_out",
  ];

  for (const select of selects) {
    const { data, error } = await supabase
      .from("bookings")
      .select(select)
      .eq("id", bookingId)
      .maybeSingle();

    if (!error) {
      return (data as unknown as BookingForReview) ?? null;
    }

    if (!isMissingColumnError(error)) {
      throw new ReviewRequestError(500, error.message || "Unable to load booking.");
    }
  }

  return null;
}

export function resolveBookingCheckoutAt(booking: BookingForReview): Date | null {
  // Prefer checkout timestamps for window timing; fall back to completion when checkout data is absent.
  const candidates = [booking.check_out_time, booking.check_out, booking.completed_at];
  for (const value of candidates) {
    if (!value || typeof value !== "string") continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

export function resolveReviewWindowExpiresAt(booking: BookingForReview): Date | null {
  const checkout = resolveBookingCheckoutAt(booking);
  if (!checkout) return null;
  return new Date(checkout.getTime() + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function isBookingReviewWindowOpen(booking: BookingForReview, now = new Date()): boolean {
  const status = String(booking.status ?? "").toLowerCase();
  if (!REVIEW_COMPLETE_STATUSES.has(status)) return false;
  const checkout = resolveBookingCheckoutAt(booking);
  if (!checkout) return false;
  const expiresAt = resolveReviewWindowExpiresAt(booking);
  if (!expiresAt) return false;
  return now >= checkout && now <= expiresAt;
}

export async function loadReviewSides(
  supabase: SupabaseClient,
  bookingId: string
): Promise<{ guestReview: ReviewRow | null; hostReview: ReviewRow | null }> {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, reviewer_role, is_published, booking_id")
    .eq("booking_id", bookingId)
    .in("reviewer_role", ["guest", "host"])
    .limit(2);

  if (error) {
    if (isMissingTableError(error)) {
      throw new ReviewRequestError(
        500,
        "reviews table is missing. Run the reviews migration before using this API.",
        "REVIEWS_TABLE_MISSING"
      );
    }
    throw new ReviewRequestError(500, error.message || "Unable to load review state.");
  }

  const rows = (Array.isArray(data) ? data : []) as ReviewRow[];
  const guestReview = rows.find((row) => row.reviewer_role === "guest") ?? null;
  const hostReview = rows.find((row) => row.reviewer_role === "host") ?? null;
  return { guestReview, hostReview };
}

export async function publishPairIfReady(
  supabase: SupabaseClient,
  bookingId: string
): Promise<{ published: boolean; publishedIds: string[] }> {
  const { guestReview, hostReview } = await loadReviewSides(supabase, bookingId);
  if (!guestReview?.id || !hostReview?.id) {
    return { published: false, publishedIds: [] };
  }

  const nowIso = new Date().toISOString();
  const ids = [guestReview.id, hostReview.id];
  const { error } = await supabase
    .from("reviews")
    .update({ is_published: true, published_at: nowIso })
    .in("id", ids);

  if (error) {
    throw new ReviewRequestError(500, error.message || "Unable to publish reviews.");
  }

  return { published: true, publishedIds: ids };
}

export async function getPublishedGuestReviewsForListing(
  supabase: SupabaseClient,
  listingId: string
): Promise<ReviewRow[]> {
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id")
    .eq("listing_id", listingId);

  if (bookingsError) {
    throw new ReviewRequestError(500, bookingsError.message || "Unable to load listing bookings.");
  }

  const bookingIds = (Array.isArray(bookings) ? bookings : [])
    .map((row: any) => row.id)
    .filter((value: any) => typeof value === "string");

  if (bookingIds.length === 0) return [];

  const { data: reviews, error: reviewsError } = await supabase
    .from("reviews")
    .select(
      "id, booking_id, reviewer_id, reviewee_id, reviewer_role, review_type, overall_score, accuracy_score, cleanliness_score, communication_score, checkin_score, noise_score, transport_score, value_score, rules_score, punctuality_score, would_stay_again, public_comment, is_published, created_at, published_at, review_window_expires_at"
    )
    .in("booking_id", bookingIds)
    .eq("review_type", "guest_to_host")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (reviewsError) {
    if (isMissingTableError(reviewsError)) {
      return [];
    }
    throw new ReviewRequestError(500, reviewsError.message || "Unable to load listing reviews.");
  }

  return (Array.isArray(reviews) ? reviews : []) as ReviewRow[];
}

export function computeListingSummaryFromRows(rows: ReviewRow[]): ListingReviewSummary {
  if (!rows.length) {
    return {
      count: 0,
      averages: zeroAverages(),
      wouldStayAgainPct: null,
    };
  }

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

  let wouldStayAgainYes = 0;
  let wouldStayAgainTotal = 0;

  rows.forEach((row) => {
    totals.overall += parseScore(row.overall_score) ?? 0;
    totals.accuracy += parseScore(row.accuracy_score) ?? 0;
    totals.cleanliness += parseScore(row.cleanliness_score) ?? 0;
    totals.communication += parseScore(row.communication_score) ?? 0;
    totals.checkin += parseScore(row.checkin_score) ?? 0;
    totals.noise += parseScore(row.noise_score) ?? 0;
    totals.transport += parseScore(row.transport_score) ?? 0;
    totals.value += parseScore(row.value_score) ?? 0;

    if (typeof row.would_stay_again === "boolean") {
      wouldStayAgainTotal += 1;
      if (row.would_stay_again) wouldStayAgainYes += 1;
    }
  });

  const count = rows.length;
  const averages: ListingReviewAverages = {
    overall: roundOne(totals.overall / count),
    accuracy: roundOne(totals.accuracy / count),
    cleanliness: roundOne(totals.cleanliness / count),
    communication: roundOne(totals.communication / count),
    checkin: roundOne(totals.checkin / count),
    noise: roundOne(totals.noise / count),
    transport: roundOne(totals.transport / count),
    value: roundOne(totals.value / count),
  };

  return {
    count,
    averages,
    wouldStayAgainPct: wouldStayAgainTotal > 0 ? roundOne((wouldStayAgainYes / wouldStayAgainTotal) * 100) : null,
  };
}

export async function toListingPublicReviews(
  supabase: SupabaseClient,
  rows: ReviewRow[]
): Promise<ListingPublicReview[]> {
  if (!rows.length) return [];

  const reviewerIds = Array.from(new Set(rows.map((row) => row.reviewer_id).filter(Boolean)));
  const profileNameMap: Record<string, string | null> = {};

  if (reviewerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", reviewerIds);

    (Array.isArray(profiles) ? profiles : []).forEach((profile: any) => {
      if (typeof profile?.id !== "string") return;
      profileNameMap[profile.id] =
        typeof profile?.full_name === "string" && profile.full_name.trim().length > 0
          ? profile.full_name.trim().split(" ").slice(0, 1).join(" ")
          : null;
    });
  }

  return rows.map((row) => ({
    id: row.id,
    bookingId: row.booking_id,
    reviewerId: row.reviewer_id,
    reviewerName: profileNameMap[row.reviewer_id] ?? null,
    overallScore: parseScore(row.overall_score) ?? 0,
    publicComment: sanitizeOptionalText(row.public_comment, PUBLIC_COMMENT_MAX),
    createdAt: row.created_at ?? null,
    publishedAt: row.published_at ?? null,
  }));
}

export async function syncListingReviewSummary(
  supabase: SupabaseClient,
  listingId: string
): Promise<void> {
  if (!listingId) return;
  const rows = await getPublishedGuestReviewsForListing(supabase, listingId);
  const summary = computeListingSummaryFromRows(rows);

  const { error } = await supabase
    .from("listings")
    .update({
      review_overall: summary.count > 0 ? summary.averages.overall : null,
      review_total: summary.count,
    })
    .eq("id", listingId);

  if (error && !isMissingColumnError(error)) {
    throw new ReviewRequestError(500, error.message || "Unable to update listing review summary.");
  }
}

export async function publishExpiredReviews(supabase: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("reviews")
    .select("id, booking_id, review_type")
    .eq("is_published", false)
    .lte("review_window_expires_at", nowIso)
    .limit(500);

  if (error) {
    if (isMissingTableError(error)) return 0;
    throw new ReviewRequestError(500, error.message || "Unable to load pending reviews.");
  }

  const rows = (Array.isArray(data) ? data : []) as Array<{
    id: string;
    booking_id: string;
    review_type: ReviewType;
  }>;

  if (!rows.length) return 0;

  const ids = rows.map((row) => row.id);
  const { error: updateError } = await supabase
    .from("reviews")
    .update({ is_published: true, published_at: nowIso })
    .in("id", ids);

  if (updateError) {
    throw new ReviewRequestError(500, updateError.message || "Unable to publish pending reviews.");
  }

  const bookingIds = Array.from(
    new Set(
      rows
        .filter((row) => row.review_type === "guest_to_host")
        .map((row) => row.booking_id)
        .filter((value) => typeof value === "string")
    )
  );

  if (bookingIds.length > 0) {
    const { data: bookingRows } = await supabase
      .from("bookings")
      .select("id, listing_id")
      .in("id", bookingIds);

    const listingIds = Array.from(
      new Set(
        (Array.isArray(bookingRows) ? bookingRows : [])
          .map((row: any) => row.listing_id)
          .filter((value: any) => typeof value === "string")
      )
    );

    for (const listingId of listingIds) {
      await syncListingReviewSummary(supabase, listingId);
    }
  }

  return ids.length;
}

export async function createReviewSubmission(params: {
  supabase: SupabaseClient;
  userId: string;
  input: CreateReviewInput;
}): Promise<{
  reviewId: string;
  bookingId: string;
  listingId: string;
  reviewType: ReviewType;
  published: boolean;
  reviewWindowExpiresAt: string;
}> {
  const { supabase, userId, input } = params;
  const bookingId = typeof input.bookingId === "string" ? input.bookingId.trim() : "";
  if (!bookingId) {
    throw new ReviewRequestError(400, "bookingId is required.");
  }

  if (input.reviewType !== "guest_to_host" && input.reviewType !== "host_to_guest") {
    throw new ReviewRequestError(400, "reviewType must be guest_to_host or host_to_guest.");
  }

  if (!isIntegerScore(input.overallScore)) {
    throw new ReviewRequestError(400, "overallScore must be an integer between 1 and 10.");
  }

  const booking = await fetchBookingForReview(supabase, bookingId);
  if (!booking?.id) {
    throw new ReviewRequestError(404, "Booking not found.");
  }
  if (!booking.listing_id) {
    throw new ReviewRequestError(400, "Booking is missing listing context.");
  }

  const windowExpiresAt = resolveReviewWindowExpiresAt(booking);
  if (!windowExpiresAt) {
    throw new ReviewRequestError(400, "Booking checkout is missing. Reviews are unavailable.");
  }

  if (!isBookingReviewWindowOpen(booking)) {
    throw new ReviewRequestError(400, "Review window is closed for this booking.");
  }

  const reviewerRole: ReviewerRole = input.reviewType === "guest_to_host" ? "guest" : "host";
  const expectedReviewerId = reviewerRole === "guest" ? booking.guest_id : booking.host_id;
  const revieweeId = reviewerRole === "guest" ? booking.host_id : booking.guest_id;
  if (!expectedReviewerId || userId !== expectedReviewerId) {
    throw new ReviewRequestError(403, "You are not allowed to review this booking.");
  }
  if (!revieweeId) {
    throw new ReviewRequestError(400, "Booking counterpart is missing.");
  }

  const { guestReview, hostReview } = await loadReviewSides(supabase, bookingId);
  if (reviewerRole === "guest" && guestReview?.id) {
    throw new ReviewRequestError(409, "Guest review already submitted for this booking.");
  }
  if (reviewerRole === "host" && hostReview?.id) {
    throw new ReviewRequestError(409, "Host review already submitted for this booking.");
  }

  const requireScore = (value: unknown, field: string): number => {
    if (!isIntegerScore(value)) {
      throw new ReviewRequestError(400, `${field} must be an integer between 1 and 10.`);
    }
    return value;
  };

  let accuracyScore: number | null = null;
  let cleanlinessScore: number | null = null;
  let communicationScore: number | null = null;
  let checkinScore: number | null = null;
  let noiseScore: number | null = null;
  let transportScore: number | null = null;
  let valueScore: number | null = null;
  let rulesScore: number | null = null;
  let punctualityScore: number | null = null;
  let wouldStayAgain: boolean | null = null;
  let wouldHostAgain: boolean | null = null;

  if (input.reviewType === "guest_to_host") {
    accuracyScore = requireScore(input.accuracyScore, "accuracyScore");
    cleanlinessScore = requireScore(input.cleanlinessScore, "cleanlinessScore");
    communicationScore = requireScore(input.communicationScore, "communicationScore");
    checkinScore = requireScore(input.checkinScore, "checkinScore");
    noiseScore = requireScore(input.noiseScore, "noiseScore");
    transportScore = requireScore(input.transportScore, "transportScore");
    valueScore = requireScore(input.valueScore, "valueScore");
    if (typeof input.wouldStayAgain !== "boolean") {
      throw new ReviewRequestError(400, "wouldStayAgain is required.");
    }
    wouldStayAgain = input.wouldStayAgain;
  } else {
    communicationScore = requireScore(input.communicationScore, "communicationScore");
    cleanlinessScore = requireScore(input.cleanlinessScore, "cleanlinessScore");
    rulesScore = requireScore(input.rulesScore, "rulesScore");
    punctualityScore = requireScore(input.punctualityScore, "punctualityScore");
    if (typeof input.wouldHostAgain !== "boolean") {
      throw new ReviewRequestError(400, "wouldHostAgain is required.");
    }
    wouldHostAgain = input.wouldHostAgain;
  }

  const publicComment = sanitizeOptionalText(input.publicComment, PUBLIC_COMMENT_MAX);
  const privateNote = sanitizeOptionalText(input.privateNote, PRIVATE_NOTE_MAX);

  const payload = {
    booking_id: bookingId,
    reviewer_id: userId,
    reviewee_id: revieweeId,
    reviewer_role: reviewerRole,
    review_type: input.reviewType,
    overall_score: input.overallScore,
    accuracy_score: accuracyScore,
    cleanliness_score: cleanlinessScore,
    communication_score: communicationScore,
    checkin_score: checkinScore,
    noise_score: noiseScore,
    transport_score: transportScore,
    value_score: valueScore,
    rules_score: rulesScore,
    punctuality_score: punctualityScore,
    would_stay_again: wouldStayAgain,
    would_host_again: wouldHostAgain,
    public_comment: publicComment,
    private_note: privateNote,
    is_published: false,
    review_window_expires_at: windowExpiresAt.toISOString(),
  };

  const { data: inserted, error: insertError } = await supabase
    .from("reviews")
    .insert(payload)
    .select("id")
    .single();

  if (insertError) {
    const message = String(insertError.message ?? "");
    if (insertError.code === "23505" || message.toLowerCase().includes("duplicate")) {
      throw new ReviewRequestError(409, "Review already submitted for this booking side.");
    }
    if (isMissingTableError(insertError)) {
      throw new ReviewRequestError(
        500,
        "reviews table is missing. Run the reviews migration before creating reviews.",
        "REVIEWS_TABLE_MISSING"
      );
    }
    throw new ReviewRequestError(500, insertError.message || "Unable to submit review.");
  }

  let published = false;
  try {
    const pairResult = await publishPairIfReady(supabase, bookingId);
    published = pairResult.published;
  } catch (error) {
    console.warn("[reviews] unable to publish pair immediately", error);
  }

  if (published) {
    await syncListingReviewSummary(supabase, booking.listing_id);
  }

  return {
    reviewId: inserted.id as string,
    bookingId,
    listingId: booking.listing_id,
    reviewType: input.reviewType,
    published,
    reviewWindowExpiresAt: windowExpiresAt.toISOString(),
  };
}

export async function getEligibilityForBooking(
  supabase: SupabaseClient,
  bookingId: string,
  userId: string
): Promise<ReviewEligibility> {
  const booking = await fetchBookingForReview(supabase, bookingId);
  if (!booking?.id) {
    throw new ReviewRequestError(404, "Booking not found.");
  }

  const isGuest = booking.guest_id === userId;
  const isHost = booking.host_id === userId;
  if (!isGuest && !isHost) {
    throw new ReviewRequestError(403, "You do not have access to this booking.");
  }

  const windowOpen = isBookingReviewWindowOpen(booking);
  const expiresAt = resolveReviewWindowExpiresAt(booking);
  const { guestReview, hostReview } = await loadReviewSides(supabase, bookingId);

  return {
    canGuestReview: isGuest && windowOpen && !guestReview?.id,
    canHostReview: isHost && windowOpen && !hostReview?.id,
    guestAlreadyReviewed: Boolean(guestReview?.id),
    hostAlreadyReviewed: Boolean(hostReview?.id),
    reviewWindowExpiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
}
