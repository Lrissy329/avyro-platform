import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

const isMissingNotesTable = (error: any) => {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42p01" || message.includes("host_booking_notes");
};

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

  const { bookingId, note } = req.body ?? {};
  if (!bookingId || typeof note !== "string" || !note.trim()) {
    return res.status(400).json({ error: "bookingId and note are required." });
  }

  const supabase = getSupabaseServerClient();
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, host_id")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking?.host_id) {
    return res.status(404).json({ error: "Booking not found." });
  }
  if (booking.host_id !== session.user.id) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { error } = await supabase.from("host_booking_notes").insert({
    booking_id: booking.id,
    host_id: session.user.id,
    note: note.trim(),
  });

  if (error) {
    if (isMissingNotesTable(error)) {
      return res.status(400).json({ error: "host_booking_notes table is missing." });
    }
    return res.status(500).json({ error: error.message, details: error });
  }

  return res.status(200).json({ ok: true });
}
