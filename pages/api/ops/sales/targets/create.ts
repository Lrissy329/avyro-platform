import type { NextApiRequest, NextApiResponse } from "next";
import { requireOpsStaffApi, logOpsForbiddenAttempt } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";

const MAX_LEADS_CREATE = 25;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const guard = await requireOpsStaffApi(req, res, { permission: "ops:sales:write" });
  if (!guard) return;
  const { admin, staff, session } = guard;

  const { areaId, staffUserId, hostsNeeded, targetDate, autoCreateLeads } = req.body as {
    areaId?: string;
    staffUserId?: string;
    hostsNeeded?: number;
    targetDate?: string;
    autoCreateLeads?: boolean;
  };

  if (!areaId || !staffUserId) {
    return res.status(400).json({ error: "areaId and staffUserId are required" });
  }

  const role = staff.role as OpsRole;
  if (role === "sales_agent" && staffUserId !== staff.user_id) {
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

  const { data: area } = await admin
    .from("areas")
    .select("id, name")
    .eq("id", areaId)
    .maybeSingle();

  if (!area) {
    return res.status(404).json({ error: "Area not found" });
  }

  const hostsNeededInt = Math.max(0, Math.floor(Number(hostsNeeded) || 0));
  const targetDateValue = targetDate?.trim() || null;

  const { data: targetRow, error: targetError } = await admin
    .from("sales_targets")
    .insert({
      area_id: areaId,
      staff_user_id: staffUserId,
      hosts_needed: hostsNeededInt,
      target_date: targetDateValue,
    })
    .select("id")
    .maybeSingle();

  if (targetError || !targetRow) {
    return res.status(400).json({ error: targetError?.message ?? "Failed to create target" });
  }

  await admin
    .from("areas")
    .update({ hosts_needed: hostsNeededInt, target_date: targetDateValue })
    .eq("id", areaId);

  let leadsCreated = 0;
  if (autoCreateLeads && hostsNeededInt > 0) {
    const createCount = Math.min(hostsNeededInt, MAX_LEADS_CREATE);
    const now = new Date().toISOString();
    const payload = Array.from({ length: createCount }).map((_, idx) => ({
      full_name: `Area lead - ${area.name} #${idx + 1}`,
      area_target: area.name,
      assigned_sales_agent_id: staffUserId,
      status: "lead_new",
      last_activity_at: now,
    }));
    const { error: leadError } = await admin.from("host_leads").insert(payload);
    if (!leadError) {
      leadsCreated = createCount;
    }
  }

  await admin.from("audit_log").insert({
    actor_staff_user_id: staff.user_id,
    action: "sales_target_assigned",
    entity_type: "area",
    entity_id: areaId,
    payload: {
      staff_user_id: staffUserId,
      hosts_needed: hostsNeededInt,
      target_date: targetDateValue,
      leads_created: leadsCreated,
    },
  });

  return res.status(200).json({
    targetId: targetRow.id,
    leadsCreated,
    leadsRequested: hostsNeededInt,
    leadLimit: MAX_LEADS_CREATE,
  });
}
