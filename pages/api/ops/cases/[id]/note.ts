import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi } from "@/lib/opsAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:cases:write" });
  if (!guard) return;
  const { admin, staff } = guard;

  const caseId = req.query.id as string;
  const { note } = req.body as { note?: string };

  if (!caseId) {
    return res.status(400).json({ error: "Missing case id" });
  }

  if (!note || !note.trim()) {
    return res.status(400).json({ error: "Note is required" });
  }

  const { error: noteError } = await admin.from("case_notes").insert({
    case_id: caseId,
    staff_user_id: staff.user_id,
    note: note.trim(),
  });

  if (noteError) {
    return res.status(400).json({ error: noteError.message });
  }

  await admin
    .from("cases")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", caseId);

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "case_note_added",
    entity_type: "case",
    entity_id: caseId,
    payload: { note: note.trim() },
  });

  return res.status(200).json({ success: true });
}
