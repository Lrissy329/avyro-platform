import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi } from "@/lib/opsAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:verification:write" });
  if (!guard) return;
  const { admin, staff } = guard;

  const { userId, status, reviewNotes } = req.body as {
    userId?: string;
    status?: "approved" | "rejected";
    reviewNotes?: string;
  };

  if (!userId || (status !== "approved" && status !== "rejected")) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const reviewPayload = {
    status,
    review_notes: reviewNotes ?? null,
    reviewed_at: new Date().toISOString(),
  };

  const { error: updateError } = await admin
    .from("guest_verifications")
    .update(reviewPayload)
    .eq("user_id", userId);

  if (updateError) {
    return res.status(400).json({ error: updateError.message });
  }

  if (status === "approved") {
    const { data: profileRow } = await admin
      .from("profiles")
      .select("verification_level")
      .eq("id", userId)
      .maybeSingle();
    const currentLevel = Number(profileRow?.verification_level) || 0;
    await admin
      .from("profiles")
      .update({ verification_status: "verified", verification_level: Math.max(currentLevel, 2) })
      .eq("id", userId);
  } else {
    await admin.from("profiles").update({ verification_status: "rejected" }).eq("id", userId);
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: status === "approved" ? "verification_approved" : "verification_rejected",
    entity_type: "guest_verification",
    entity_id: userId,
    payload: reviewPayload,
  });

  return res.status(200).json({ success: true });
}
