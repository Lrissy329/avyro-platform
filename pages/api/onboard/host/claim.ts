import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = (req.headers.authorization ?? "").replace(/Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const { token: inviteToken } = req.body as { token?: string };
  if (!inviteToken) {
    return res.status(400).json({ error: "Missing invite token" });
  }

  const admin = getSupabaseServerClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  const { data: invite } = await admin
    .from("host_invites")
    .select("id, lead_id, created_by, expires_at, claimed_by")
    .eq("token", inviteToken)
    .maybeSingle();

  if (!invite) {
    return res.status(404).json({ error: "Invite not found" });
  }

  if (invite.claimed_by) {
    return res.status(409).json({ error: "Invite already claimed" });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: "Invite expired" });
  }

  const claimedAt = new Date().toISOString();

  await admin
    .from("host_invites")
    .update({ claimed_by: userData.user.id, claimed_at: claimedAt })
    .eq("id", invite.id);

  await admin
    .from("host_leads")
    .update({
      converted_host_user_id: userData.user.id,
      status: "claimed",
      last_activity_at: claimedAt,
    })
    .eq("id", invite.lead_id);

  await admin
    .from("profiles")
    .upsert(
      {
        id: userData.user.id,
        role_host: true,
        referred_by_sales_agent: invite.created_by,
      },
      { onConflict: "id" }
    );

  await admin.from("audit_log").insert({
    actor_staff_user_id: invite.created_by,
    action: "invite_claimed",
    entity_type: "host_lead",
    entity_id: invite.lead_id,
    payload: { invite_id: invite.id, claimed_by: userData.user.id },
  });

  return res.status(200).json({ success: true });
}
