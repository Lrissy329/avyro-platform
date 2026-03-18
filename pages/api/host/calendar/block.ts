import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

const toISODate = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
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

  const { listingId, startDate, endDate, startAt, endAt } = req.body ?? {};
  const hasDateRange = Boolean(startDate && endDate);
  const hasTimeRange = Boolean(startAt && endAt);

  if (!listingId || (!hasDateRange && !hasTimeRange)) {
    return res.status(400).json({
      error: "listingId and either startDate/endDate or startAt/endAt are required.",
    });
  }

  const startIso = hasDateRange ? toISODate(startDate) : null;
  const endIso = hasDateRange ? toISODate(endDate) : null;
  if (hasDateRange && (!startIso || !endIso)) {
    return res.status(400).json({ error: "Invalid startDate or endDate." });
  }

  const startAtDate = hasTimeRange ? new Date(startAt) : null;
  const endAtDate = hasTimeRange ? new Date(endAt) : null;
  if (hasTimeRange) {
    if (!startAtDate || !endAtDate || !Number.isFinite(startAtDate.getTime()) || !Number.isFinite(endAtDate.getTime())) {
      return res.status(400).json({ error: "Invalid startAt or endAt." });
    }
  }

  const supabase = getSupabaseServerClient();
  const listingIdValue = String(listingId);
  const { data: ownedListing, error: ownerError } = await supabase
    .from("listings")
    .select("id")
    .eq("id", listingIdValue)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (ownerError) {
    return res.status(500).json({ error: ownerError.message, details: ownerError });
  }
  if (!ownedListing?.id) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { data, error } = await supabase
    .from("listing_calendar_blocks")
    .insert({
      listing_id: listingIdValue,
      start_date: startIso ?? startAtDate?.toISOString().slice(0, 10),
      end_date: endIso ?? endAtDate?.toISOString().slice(0, 10),
      start_at: hasTimeRange ? startAtDate?.toISOString() : null,
      end_at: hasTimeRange ? endAtDate?.toISOString() : null,
      source: "manual",
      label: "Manual block",
    })
    .select("id, listing_id, start_date, end_date, start_at, end_at, source, label")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message, details: error });
  }

  return res.status(200).json({ ok: true, block: data });
}
