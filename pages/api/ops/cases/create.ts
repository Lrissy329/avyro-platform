import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi } from "@/lib/opsAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:cases:write" });
  if (!guard) return;
  const { admin, staff } = guard;

  const { bookingId } = req.body as { bookingId?: string };
  if (!bookingId) {
    return res.status(400).json({ error: "bookingId is required" });
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("id, guest_id, host_id, listing_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  const { data: caseRow, error: caseError } = await admin
    .from("cases")
    .insert({
      status: "open",
      priority: "normal",
      assigned_to: staff.user_id,
      booking_id: booking.id,
      guest_id: booking.guest_id,
      host_id: booking.host_id,
      listing_id: booking.listing_id,
      subject: `Booking case ${booking.id}`,
      last_activity_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (caseError || !caseRow?.id) {
    return res.status(400).json({ error: caseError?.message ?? "Failed to create case" });
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "case_created",
    entity_type: "case",
    entity_id: caseRow.id,
    payload: { booking_id: booking.id },
  });

  return res.status(200).json({ caseId: caseRow.id });
}
