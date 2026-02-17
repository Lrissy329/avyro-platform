import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi, logOpsForbiddenAttempt } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:sales:write" });
  if (!guard) return;
  const { admin, staff, session } = guard;

  const leadId = req.query.id as string;
  const { note } = req.body as { note?: string };

  if (!leadId) {
    return res.status(400).json({ error: "Missing lead id" });
  }

  if (!note || !note.trim()) {
    return res.status(400).json({ error: "Note is required" });
  }

  const { data: lead } = await admin
    .from("host_leads")
    .select("id, assigned_sales_agent_id")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) {
    return res.status(404).json({ error: "Lead not found" });
  }

  const role = staff.role as OpsRole;
  if (role === "sales_agent" && lead.assigned_sales_agent_id !== staff.user_id) {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff.user_id,
      role,
      path: req.url,
      permission: "ops:sales:write",
      reason: "lead_not_assigned",
    });
    return res.status(403).json({ error: "Forbidden" });
  }

  const { error: noteError } = await admin.from("host_lead_notes").insert({
    lead_id: leadId,
    staff_user_id: staff.user_id,
    note: note.trim(),
  });

  if (noteError) {
    return res.status(400).json({ error: noteError.message });
  }

  await admin
    .from("host_leads")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", leadId);

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "host_lead_note_added",
    entity_type: "host_lead",
    entity_id: leadId,
    payload: { note: note.trim() },
  });

  return res.status(200).json({ success: true });
}
