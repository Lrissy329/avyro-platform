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

  const { guestId } = req.body ?? {};
  if (typeof guestId !== "string" || !UUID_RE.test(guestId)) {
    return res.status(400).json({ error: "guestId is required." });
  }

  const supabase = getSupabaseServerClient();

  const { data: bookingRow, error: bookingError } = await supabase
    .from("bookings")
    .select("id")
    .eq("host_id", session.user.id)
    .eq("guest_id", guestId)
    .limit(1)
    .maybeSingle();

  if (bookingError) {
    return res.status(500).json({ error: bookingError.message });
  }
  if (!bookingRow?.id) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, headline, bio, verification_status")
    .eq("id", guestId)
    .maybeSingle();

  if (profileError) {
    return res.status(500).json({ error: profileError.message });
  }
  if (!profile?.id) {
    return res.status(404).json({ error: "Guest profile not found." });
  }

  return res.status(200).json({
    id: profile.id,
    full_name: profile.full_name ?? null,
    avatar_url: profile.avatar_url ?? null,
    headline: profile.headline ?? null,
    bio: profile.bio ?? null,
    is_verified: profile.verification_status === "verified",
    verification_status: profile.verification_status ?? null,
  });
}
