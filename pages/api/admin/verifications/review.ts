import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

const parseAllowlist = () =>
  (process.env.ADMIN_EMAIL_ALLOWLIST || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const isAllowed = (email: string | null | undefined) => {
  if (!email) return false;
  const allowlist = parseAllowlist();
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.toLowerCase());
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseServerClient();
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace(/Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  if (!isAllowed(userData.user.email)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  if (req.method === "GET") {
    const { data: pendingRows, error } = await supabase
      .from("guest_verifications")
      .select("user_id, work_email, document_type, document_url, status, review_notes, updated_at")
      .eq("status", "pending")
      .order("updated_at", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const userIds = (pendingRows ?? []).map((row: any) => row.user_id).filter(Boolean);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url, verification_level, verification_status")
      .in("id", userIds.length ? userIds : ["__none__"]);

    const profileMap = new Map(
      (profiles ?? []).map((p: any) => [p.id, p])
    );

    const items = (pendingRows ?? []).map((row: any) => ({
      ...row,
      profile: profileMap.get(row.user_id) ?? null,
    }));

    return res.status(200).json({ items });
  }

  if (req.method === "POST") {
    const { userId, action, notes } = req.body as {
      userId?: string;
      action?: "approve" | "reject";
      notes?: string;
    };

    if (!userId || (action !== "approve" && action !== "reject")) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    if (action === "approve") {
      await supabase
        .from("guest_verifications")
        .update({ status: "approved", review_notes: notes ?? null })
        .eq("user_id", userId);

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("verification_level")
        .eq("id", userId)
        .maybeSingle();
      const currentLevel = Number(profileRow?.verification_level) || 0;
      const nextLevel = Math.max(currentLevel, 2);

      await supabase
        .from("profiles")
        .update({ verification_level: nextLevel, verification_status: "verified" })
        .eq("id", userId);
    }

    if (action === "reject") {
      await supabase
        .from("guest_verifications")
        .update({ status: "rejected", review_notes: notes ?? null })
        .eq("user_id", userId);

      await supabase
        .from("profiles")
        .update({ verification_status: "rejected" })
        .eq("id", userId);
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
