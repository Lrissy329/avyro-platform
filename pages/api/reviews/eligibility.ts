import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  getEligibilityForBooking,
  publishExpiredReviews,
  ReviewRequestError,
} from "@/lib/reviewSystem";

const EMPTY_ELIGIBILITY = {
  canGuestReview: false,
  canHostReview: false,
  guestAlreadyReviewed: false,
  hostAlreadyReviewed: false,
  reviewWindowExpiresAt: null,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const bookingId = typeof req.query.bookingId === "string" ? req.query.bookingId.trim() : "";
  if (!bookingId) {
    return res.status(400).json({ error: "bookingId is required." });
  }

  const authClient = createPagesServerClient({ req, res });
  const {
    data: { session },
    error: sessionError,
  } = await authClient.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const admin = getSupabaseServerClient();

  try {
    await publishExpiredReviews(admin);
    const eligibility = await getEligibilityForBooking(admin, bookingId, session.user.id);
    return res.status(200).json(eligibility);
  } catch (error: any) {
    if (error instanceof ReviewRequestError) {
      if (error.code === "REVIEWS_TABLE_MISSING") {
        return res.status(200).json(EMPTY_ELIGIBILITY);
      }
      return res.status(error.status).json({
        error: error.message,
        code: error.code ?? null,
      });
    }
    console.error("[api/reviews/eligibility] unexpected error", error);
    return res.status(500).json({ error: "Unable to determine review eligibility." });
  }
}
