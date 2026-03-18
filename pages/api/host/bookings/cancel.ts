import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

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

  const { bookingId } = req.body ?? {};
  if (!bookingId) {
    return res.status(400).json({ error: "bookingId is required." });
  }

  const supabase = getSupabaseServerClient();
  const { data: bookingRow, error: bookingError } = await supabase
    .from("bookings")
    .select("id, host_id, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    return res.status(500).json({ error: bookingError.message, details: bookingError });
  }
  if (!bookingRow?.id) {
    return res.status(404).json({ error: "Booking not found." });
  }
  if (bookingRow.host_id !== session.user.id) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("host_id", session.user.id)
    .select("id, status")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message, details: error });
  }

  return res.status(200).json({ ok: true, booking: data });
}
