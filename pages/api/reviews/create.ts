import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  createReviewSubmission,
  publishExpiredReviews,
  ReviewRequestError,
  type CreateReviewInput,
} from "@/lib/reviewSystem";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
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
  const body = (req.body ?? {}) as Partial<CreateReviewInput>;

  try {
    await publishExpiredReviews(admin);

    const created = await createReviewSubmission({
      supabase: admin,
      userId: session.user.id,
      input: {
        bookingId: String(body.bookingId ?? ""),
        reviewType: body.reviewType as any,
        overallScore: Number(body.overallScore),
        accuracyScore: body.accuracyScore,
        cleanlinessScore: body.cleanlinessScore,
        communicationScore: body.communicationScore,
        checkinScore: body.checkinScore,
        noiseScore: body.noiseScore,
        transportScore: body.transportScore,
        valueScore: body.valueScore,
        rulesScore: body.rulesScore,
        punctualityScore: body.punctualityScore,
        wouldStayAgain: body.wouldStayAgain,
        wouldHostAgain: body.wouldHostAgain,
        publicComment: body.publicComment,
        privateNote: body.privateNote,
      },
    });

    return res.status(201).json({
      review: {
        id: created.reviewId,
        bookingId: created.bookingId,
        listingId: created.listingId,
        reviewType: created.reviewType,
        published: created.published,
        reviewWindowExpiresAt: created.reviewWindowExpiresAt,
      },
    });
  } catch (error: any) {
    if (error instanceof ReviewRequestError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code ?? null,
      });
    }

    console.error("[api/reviews/create] unexpected error", error);
    return res.status(500).json({ error: "Unable to submit review." });
  }
}

