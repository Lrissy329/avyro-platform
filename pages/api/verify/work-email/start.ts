import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

const TOKEN_TTL_MINUTES = 30;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  const { workEmail } = req.body as { workEmail?: string };
  if (!workEmail || !workEmail.includes("@")) {
    return res.status(400).json({ error: "Valid workEmail is required" });
  }

  const verificationToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  const { error: verificationError } = await supabase
    .from("guest_verifications")
    .upsert(
      {
        user_id: userData.user.id,
        work_email: workEmail,
        work_email_token: verificationToken,
        work_email_token_expires_at: expiresAt,
        work_email_verified_at: null,
      },
      { onConflict: "user_id" }
    );

  if (verificationError) {
    return res.status(500).json({ error: verificationError.message });
  }

  const origin =
    (req.headers.origin as string | undefined) ||
    `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
  const verificationUrl = `${origin}/verify/work-email?token=${verificationToken}`;

  console.log("[work-email] verification link", verificationUrl);

  return res.status(200).json({ success: true, verificationUrl });
}
