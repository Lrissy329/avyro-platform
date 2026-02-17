import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi, logOpsForbiddenAttempt } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";

const ALLOWED_STATUSES = new Set(["lead_new", "invited", "claimed", "live", "lost"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:sales:write" });
  if (!guard) return;
  const { admin, staff, session } = guard;

  const { leadId, status } = req.body as { leadId?: string; status?: string };

  if (!leadId || !status) {
    return res.status(400).json({ error: "leadId and status are required" });
  }

  if (!ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const { data: lead } = await admin
    .from("host_leads")
    .select("id, status, assigned_sales_agent_id")
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

  if (role === "sales_agent" && status !== "lost") {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff.user_id,
      role,
      path: req.url,
      permission: "ops:sales:write",
      reason: "status_change_restricted",
    });
    return res.status(403).json({ error: "Forbidden" });
  }

  const { error } = await admin
    .from("host_leads")
    .update({
      status,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "lead_status_updated",
    entity_type: "host_lead",
    entity_id: leadId,
    payload: {
      from: lead.status,
      to: status,
    },
  });

  return res.status(200).json({ success: true });
}
