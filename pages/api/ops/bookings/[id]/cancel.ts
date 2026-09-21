import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi } from "@/lib/opsAuth";
import { canSelfCancelBooking } from "@/lib/bookingStatus";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:bookings:write" });
  if (!guard) return;
  const { admin, staff } = guard;

  const bookingId = req.query.id as string;
  if (!bookingId) {
    return res.status(400).json({ error: "Missing booking id" });
  }

  const { data: bookingRow, error: fetchError } = await admin
    .from("bookings")
    .select("status, stripe_status")
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json({ error: fetchError.message });
  }
  if (!bookingRow) {
    return res.status(404).json({ error: "Booking not found." });
  }
  if (!canSelfCancelBooking(bookingRow.status, bookingRow.stripe_status)) {
    return res.status(409).json({
      error: "This booking has a completed payment. Use Full Refund instead of Cancel.",
      code: "USE_REFUND_INSTEAD",
    });
  }

  const { error: updateError } = await admin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);

  if (updateError) {
    return res.status(400).json({ error: updateError.message });
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "booking_cancelled",
    entity_type: "booking",
    entity_id: bookingId,
    payload: { status: "cancelled" },
  });

  return res.status(200).json({ success: true });
}
