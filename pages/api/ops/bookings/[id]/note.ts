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
  const { note } = req.body as { note?: string };

  if (!bookingId) {
    return res.status(400).json({ error: "Missing booking id" });
  }

  if (!note || !note.trim()) {
    return res.status(400).json({ error: "Note is required" });
  }

  const { error: noteError } = await admin.from("booking_notes").insert({
    booking_id: bookingId,
    staff_user_id: staff.user_id,
    note: note.trim(),
  });

  if (noteError) {
    return res.status(400).json({ error: noteError.message });
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "booking_note_added",
    entity_type: "booking",
    entity_id: bookingId,
    payload: { note: note.trim() },
  });

  return res.status(200).json({ success: true });
}
