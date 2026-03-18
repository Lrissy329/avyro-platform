import type { NextApiRequest, NextApiResponse } from "next";

import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { publishExpiredReviews, ReviewRequestError } from "@/lib/reviewSystem";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.REVIEWS_CRON_SECRET;
  if (!secret) {
    return res.status(501).json({ error: "REVIEWS_CRON_SECRET is not configured." });
  }

  const providedSecret =
    (req.headers["x-cron-secret"] as string | undefined) ??
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!providedSecret || providedSecret !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const admin = getSupabaseServerClient();

  try {
    const publishedCount = await publishExpiredReviews(admin);
    return res.status(200).json({ ok: true, publishedCount });
  } catch (error: any) {
    if (error instanceof ReviewRequestError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code ?? null,
      });
    }
    console.error("[api/reviews/publish-pending] unexpected error", error);
    return res.status(500).json({ error: "Unable to publish pending reviews." });
  }
}

