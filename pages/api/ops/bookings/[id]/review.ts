import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi } from "@/lib/opsAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:bookings:write" });
  if (!guard) return;
  const { admin, staff } = guard;

  const bookingId = req.query.id as string;
  const { needsReview } = req.body as { needsReview?: boolean };

  if (!bookingId) {
    return res.status(400).json({ error: "Missing booking id" });
  }

  if (typeof needsReview !== "boolean") {
    return res.status(400).json({ error: "needsReview must be boolean" });
  }

  const { error: updateError } = await admin
    .from("bookings")
    .update({ needs_review: needsReview })
    .eq("id", bookingId);

  if (updateError) {
    return res.status(400).json({ error: updateError.message });
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: needsReview ? "booking_marked_needs_review" : "booking_cleared_review",
    entity_type: "booking",
    entity_id: bookingId,
    payload: { needs_review: needsReview },
  });

  return res.status(200).json({ success: true });
}
