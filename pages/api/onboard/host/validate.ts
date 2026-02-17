import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }

  const admin = getSupabaseServerClient();
  const { data: invite } = await admin
    .from("host_invites")
    .select("lead_id, email, expires_at, claimed_by")
    .eq("token", token)
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

  return res.status(200).json({
    leadId: invite.lead_id,
    email: invite.email ?? null,
    status: "valid",
    expiresAt: invite.expires_at,
  });
}
