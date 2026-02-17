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

  const { leadId, assignedSalesAgentId } = req.body as {
    leadId?: string;
    assignedSalesAgentId?: string;
  };

  if (!leadId || !assignedSalesAgentId) {
    return res.status(400).json({ error: "leadId and assignedSalesAgentId are required" });
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
  if (role === "sales_agent") {
    const isOwner = lead.assigned_sales_agent_id === staff.user_id;
    const isSelfAssign = assignedSalesAgentId === staff.user_id;
    if (!isOwner || !isSelfAssign) {
      await logOpsForbiddenAttempt({
        userId: session.user.id,
        staffUserId: staff.user_id,
        role,
        path: req.url,
        permission: "ops:sales:write",
        reason: "cannot_reassign",
      });
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const { error } = await admin
    .from("host_leads")
    .update({
      assigned_sales_agent_id: assignedSalesAgentId,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "lead_reassigned",
    entity_type: "host_lead",
    entity_id: leadId,
    payload: {
      from: lead.assigned_sales_agent_id,
      to: assignedSalesAgentId,
    },
  });

  return res.status(200).json({ success: true });
}
