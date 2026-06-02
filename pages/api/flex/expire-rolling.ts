import type { NextApiRequest, NextApiResponse } from "next";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

type ExpireRollingResponse =
  | {
      ok: true;
      scanned: number;
      expired: number;
      bookingsUpdated: number;
    }
  | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExpireRollingResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.FLEX_CRON_SECRET;
  if (!secret) {
    return res.status(501).json({ error: "FLEX_CRON_SECRET is not configured." });
  }

  const providedSecret =
    (req.headers["x-cron-secret"] as string | undefined) ??
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!providedSecret || providedSecret !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabaseServerClient();
  const now = new Date();

  const heldRowsResult = await supabase
    .from("booking_flex_windows")
    .select("id, booking_id, cutoff_at")
    .eq("status", "held")
    .not("cutoff_at", "is", null)
    .lte("cutoff_at", now.toISOString())
    .limit(5000);

  if (heldRowsResult.error) {
    return res.status(500).json({ error: heldRowsResult.error.message ?? "Unable to load held windows." });
  }

  const rows = heldRowsResult.data ?? [];
  if (!rows.length) {
    return res.status(200).json({ ok: true, scanned: 0, expired: 0, bookingsUpdated: 0 });
  }

  const ids = rows.map((row) => String(row.id)).filter(Boolean);
  const bookingIds = Array.from(new Set(rows.map((row) => String(row.booking_id)).filter(Boolean)));

  const expireResult = await supabase
    .from("booking_flex_windows")
    .update({
      status: "expired",
      updated_at: now.toISOString(),
    })
    .in("id", ids)
    .eq("status", "held")
    .select("id, booking_id");

  if (expireResult.error) {
    return res.status(500).json({ error: expireResult.error.message ?? "Unable to expire held windows." });
  }

  let bookingsUpdated = 0;
  if (bookingIds.length > 0) {
    const remainingHeldResult = await supabase
      .from("booking_flex_windows")
      .select("booking_id")
      .in("booking_id", bookingIds)
      .eq("status", "held");

    if (remainingHeldResult.error) {
      return res.status(500).json({ error: remainingHeldResult.error.message ?? "Unable to verify remaining windows." });
    }

    const remainingHeldBookingIds = new Set(
      (remainingHeldResult.data ?? [])
        .map((row) => String(row.booking_id))
        .filter(Boolean)
    );

    const bookingIdsToExpire = bookingIds.filter((id) => !remainingHeldBookingIds.has(id));
    if (bookingIdsToExpire.length > 0) {
      const bookingUpdateResult = await supabase
        .from("bookings")
        .update({
          flex_status: "expired",
          flex_extension_cutoff_at: null,
        })
        .in("id", bookingIdsToExpire)
        .eq("flex_mode", "rolling")
        .select("id");

      if (bookingUpdateResult.error) {
        return res.status(500).json({ error: bookingUpdateResult.error.message ?? "Unable to update booking statuses." });
      }
      bookingsUpdated = bookingUpdateResult.data?.length ?? 0;
    }
  }

  return res.status(200).json({
    ok: true,
    scanned: rows.length,
    expired: expireResult.data?.length ?? 0,
    bookingsUpdated,
  });
}

