import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  publishExpiredReviews,
  ReviewRequestError,
  isMissingTableError,
} from "@/lib/reviewSystem";

const roundOne = (value: number) => Number(value.toFixed(1));

const toScore = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  const guestId =
    typeof req.query.guestId === "string" ? req.query.guestId.trim() : session.user.id;

  const admin = getSupabaseServerClient();

  try {
    await publishExpiredReviews(admin);

    let canAccess = guestId === session.user.id;

    if (!canAccess) {
      const [{ data: hostRelation }, { data: staffUser }] = await Promise.all([
        admin
          .from("bookings")
          .select("id")
          .eq("guest_id", guestId)
          .eq("host_id", session.user.id)
          .limit(1),
        admin
          .from("staff_users")
          .select("user_id, active")
          .eq("user_id", session.user.id)
          .eq("active", true)
          .maybeSingle(),
      ]);

      canAccess = Boolean(
        (Array.isArray(hostRelation) && hostRelation.length > 0) || staffUser?.user_id
      );
    }

    if (!canAccess) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data, error } = await admin
      .from("reviews")
      .select(
        "id, reviewer_id, overall_score, communication_score, cleanliness_score, rules_score, punctuality_score, would_host_again, public_comment, created_at, is_published"
      )
      .eq("review_type", "host_to_guest")
      .eq("reviewee_id", guestId)
      .eq("is_published", true)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        return res.status(200).json({
          guestId,
          summary: {
            count: 0,
            averages: {
              overall: 0,
              communication: 0,
              cleanliness: 0,
              rules: 0,
              punctuality: 0,
            },
            wouldHostAgainPct: null,
          },
          reviews: [],
        });
      }
      throw new ReviewRequestError(500, error.message || "Unable to load guest reviews.");
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return res.status(200).json({
        guestId,
        summary: {
          count: 0,
          averages: {
            overall: 0,
            communication: 0,
            cleanliness: 0,
            rules: 0,
            punctuality: 0,
          },
          wouldHostAgainPct: null,
        },
        reviews: [],
      });
    }

    const totals = {
      overall: 0,
      communication: 0,
      cleanliness: 0,
      rules: 0,
      punctuality: 0,
    };
    let wouldHostAgainYes = 0;
    let wouldHostAgainTotal = 0;

    rows.forEach((row: any) => {
      totals.overall += toScore(row.overall_score);
      totals.communication += toScore(row.communication_score);
      totals.cleanliness += toScore(row.cleanliness_score);
      totals.rules += toScore(row.rules_score);
      totals.punctuality += toScore(row.punctuality_score);
      if (typeof row.would_host_again === "boolean") {
        wouldHostAgainTotal += 1;
        if (row.would_host_again) wouldHostAgainYes += 1;
      }
    });

    const count = rows.length;
    const summary = {
      count,
      averages: {
        overall: roundOne(totals.overall / count),
        communication: roundOne(totals.communication / count),
        cleanliness: roundOne(totals.cleanliness / count),
        rules: roundOne(totals.rules / count),
        punctuality: roundOne(totals.punctuality / count),
      },
      wouldHostAgainPct:
        wouldHostAgainTotal > 0 ? roundOne((wouldHostAgainYes / wouldHostAgainTotal) * 100) : null,
    };

    const reviewerIds = Array.from(
      new Set(
        rows.map((row: any) => row.reviewer_id).filter((value: unknown): value is string => typeof value === "string")
      )
    );
    const profileNameMap: Record<string, string | null> = {};
    if (reviewerIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, full_name")
        .in("id", reviewerIds);
      (Array.isArray(profiles) ? profiles : []).forEach((profile: any) => {
        if (typeof profile?.id !== "string") return;
        profileNameMap[profile.id] =
          typeof profile?.full_name === "string"
            ? profile.full_name.split(" ").slice(0, 1).join(" ")
            : null;
      });
    }

    const reviews = rows.map((row: any) => ({
      id: row.id,
      reviewerId: row.reviewer_id ?? null,
      reviewerName: row.reviewer_id ? profileNameMap[row.reviewer_id] ?? null : null,
      overallScore: toScore(row.overall_score),
      communicationScore: toScore(row.communication_score),
      cleanlinessScore: toScore(row.cleanliness_score),
      rulesScore: toScore(row.rules_score),
      punctualityScore: toScore(row.punctuality_score),
      wouldHostAgain:
        typeof row.would_host_again === "boolean" ? row.would_host_again : null,
      publicComment:
        typeof row.public_comment === "string" && row.public_comment.trim()
          ? row.public_comment.trim()
          : null,
      createdAt: row.created_at ?? null,
    }));

    return res.status(200).json({
      guestId,
      summary,
      reviews,
    });
  } catch (error: any) {
    if (error instanceof ReviewRequestError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code ?? null,
      });
    }
    console.error("[api/reviews/guest] unexpected error", error);
    return res.status(500).json({ error: "Unable to load guest reviews." });
  }
}

