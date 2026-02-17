import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token =
    (req.method === "GET" ? req.query.token : req.body?.token) ??
    req.body?.token;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Missing token" });
  }

  const supabase = getSupabaseServerClient();
  const { data: verificationRow, error: verificationError } = await supabase
    .from("guest_verifications")
    .select("user_id, work_email_token_expires_at")
    .eq("work_email_token", token)
    .maybeSingle();

  if (verificationError) {
    return res.status(500).json({ error: verificationError.message });
  }

  if (!verificationRow?.user_id) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  const expiresAt = verificationRow.work_email_token_expires_at
    ? new Date(verificationRow.work_email_token_expires_at)
    : null;
  if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: "Token expired" });
  }

  const nowIso = new Date().toISOString();

  await supabase
    .from("guest_verifications")
    .update({
      work_email_verified_at: nowIso,
      work_email_token: null,
      work_email_token_expires_at: null,
    })
    .eq("user_id", verificationRow.user_id);

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("verification_level")
    .eq("id", verificationRow.user_id)
    .maybeSingle();

  const currentLevel = Number(profileRow?.verification_level) || 0;
  const nextLevel = Math.max(currentLevel, 1);

  await supabase
    .from("profiles")
    .update({
      verification_level: nextLevel,
      verification_status: "verified",
    })
    .eq("id", verificationRow.user_id);

  return res.status(200).json({ success: true });
}
