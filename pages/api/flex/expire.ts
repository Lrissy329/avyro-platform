import type { NextApiRequest, NextApiResponse } from "next";

import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getFlexCutoffAt, isMissingColumnError } from "@/lib/flexStay";

type ExpireResponse =
  | {
      ok: true;
      scanned: number;
      expired: number;
    }
  | { error: string };

const bookingSelects = [
  "id, check_out_time, flex_extra_night_status, flex_extra_night_cutoff_at",
  "id, check_out_time, flex_extra_night_status",
] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ExpireResponse>) {
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

  let rows: any[] = [];
  let rowsError: any = null;
  for (const select of bookingSelects) {
    const result = await supabase
      .from("bookings")
      .select(select)
      .eq("flex_extra_night_status", "reserved")
      .limit(5000);
    rows = result.data ?? [];
    rowsError = result.error;
    if (!rowsError) break;
    if (!isMissingColumnError(rowsError)) break;
  }

  if (rowsError) {
    return res.status(500).json({ error: rowsError.message ?? "Unable to load flex bookings." });
  }

  const now = new Date();
  const idsToExpire = rows
    .filter((row) => {
      const cutoff = getFlexCutoffAt(row.check_out_time ?? null, row.flex_extra_night_cutoff_at ?? null);
      if (!cutoff) return false;
      return cutoff.getTime() <= now.getTime();
    })
    .map((row) => String(row.id))
    .filter(Boolean);

  if (idsToExpire.length === 0) {
    return res.status(200).json({ ok: true, scanned: rows.length, expired: 0 });
  }

  const updatePayload: Record<string, any> = {
    flex_extra_night_status: "expired",
    flex_extra_night_released_at: now.toISOString(),
  };

  let update = await supabase
    .from("bookings")
    .update(updatePayload)
    .in("id", idsToExpire)
    .eq("flex_extra_night_status", "reserved")
    .select("id");

  if (update.error && isMissingColumnError(update.error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.flex_extra_night_released_at;
    update = await supabase
      .from("bookings")
      .update(fallbackPayload)
      .in("id", idsToExpire)
      .eq("flex_extra_night_status", "reserved")
      .select("id");
  }

  if (update.error) {
    return res.status(500).json({ error: update.error.message ?? "Unable to expire flex bookings." });
  }

  return res.status(200).json({
    ok: true,
    scanned: rows.length,
    expired: update.data?.length ?? 0,
  });
}
