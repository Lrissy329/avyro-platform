import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { requireOpsStaffApi, logOpsForbiddenAttempt } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";

const TOKEN_TTL_DAYS = 7;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:sales:write" });
  if (!guard) return;
  const { admin, staff, session } = guard;

  const { leadId } = req.body as { leadId?: string };
  if (!leadId) {
    return res.status(400).json({ error: "leadId is required" });
  }

  const { data: lead } = await admin
    .from("host_leads")
    .select("id, email, assigned_sales_agent_id, status")
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

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error: inviteError } = await admin.from("host_invites").insert({
    lead_id: lead.id,
    token,
    expires_at: expiresAt,
    email: lead.email,
    created_by: staff.user_id,
  });

  if (inviteError) {
    return res.status(400).json({ error: inviteError.message });
  }

  await admin
    .from("host_leads")
    .update({ status: "invited", last_activity_at: new Date().toISOString() })
    .eq("id", lead.id);

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "invite_sent",
    entity_type: "host_lead",
    entity_id: lead.id,
    payload: { token, expires_at: expiresAt },
  });

  const origin =
    (req.headers.origin as string | undefined) ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:3000";
  const inviteUrl = `${origin}/onboard/host?token=${token}`;

  return res.status(200).json({ inviteUrl });
}
