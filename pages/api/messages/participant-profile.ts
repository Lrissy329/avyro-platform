import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authClient = createPagesServerClient({ req, res });
  const {
    data: { session },
    error: sessionError,
  } = await authClient.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { participantId } = req.body ?? {};
  if (typeof participantId !== "string" || !UUID_RE.test(participantId)) {
    return res.status(400).json({ error: "participantId is required." });
  }

  const supabase = getSupabaseServerClient();
  const userId = session.user.id;

  const { data: conversationRow, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .or(
      `and(guest_id.eq.${userId},host_id.eq.${participantId}),and(host_id.eq.${userId},guest_id.eq.${participantId})`
    )
    .limit(1)
    .maybeSingle();

  if (conversationError) {
    return res.status(500).json({ error: conversationError.message });
  }
  if (!conversationRow?.id) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, email")
    .eq("id", participantId)
    .maybeSingle();

  if (profileError) {
    return res.status(500).json({ error: profileError.message });
  }
  if (!profile?.id) {
    return res.status(404).json({ error: "Profile not found." });
  }

  return res.status(200).json({
    id: profile.id,
    full_name: profile.full_name ?? null,
    avatar_url: profile.avatar_url ?? null,
    email: profile.email ?? null,
  });
}
