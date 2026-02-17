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

  const {
    full_name,
    email,
    phone,
    area_target,
    commission_plan,
    assigned_sales_agent_id,
  } = req.body as {
    full_name?: string;
    email?: string;
    phone?: string;
    area_target?: string;
    commission_plan?: string;
    assigned_sales_agent_id?: string;
  };

  if (!full_name && !email) {
    return res.status(400).json({ error: "Full name or email is required" });
  }

  const role = staff.role as OpsRole;
  let assignedSalesAgent = assigned_sales_agent_id ?? null;
  if (assignedSalesAgent && assignedSalesAgent.trim().length === 0) {
    assignedSalesAgent = null;
  }
  if (!assignedSalesAgent && role === "sales_agent") {
    assignedSalesAgent = staff.user_id;
  }

  if (role === "sales_agent" && assignedSalesAgent && assignedSalesAgent !== staff.user_id) {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff.user_id,
      role,
      path: req.url,
      permission: "ops:sales:write",
      reason: "cannot_assign_other_agent",
    });
    return res.status(403).json({ error: "Forbidden" });
  }

  const { data: lead, error } = await admin
    .from("host_leads")
    .insert({
      full_name: full_name?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      area_target: area_target?.trim() || null,
      commission_plan: commission_plan?.trim() || null,
      assigned_sales_agent_id: assignedSalesAgent,
      status: "lead_new",
      last_activity_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error || !lead) {
    return res.status(400).json({ error: error?.message ?? "Failed to create lead" });
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "lead_created",
    entity_type: "host_lead",
    entity_id: lead.id,
    payload: {
      full_name: full_name?.trim() || null,
      email: email?.trim() || null,
      assigned_sales_agent_id: assignedSalesAgent,
    },
  });

  return res.status(200).json({ id: lead.id });
}
