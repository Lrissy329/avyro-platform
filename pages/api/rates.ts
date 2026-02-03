import type { NextApiRequest, NextApiResponse } from "next";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabaseServerClient();
  const { start, end } = req.query;
  const listingIds = req.query.listingId;

  if (!start || !end || !listingIds) {
    return res.status(400).json({ error: "Missing start, end, or listingId parameters" });
  }

  const listingIdArray = Array.isArray(listingIds) ? listingIds : [listingIds];

  const { data, error } = await supabase
    .from("nightly_rates")
    .select("listing_id, date, price, currency")
    .gte("date", start as string)
    .lte("date", end as string)
    .in("listing_id", listingIdArray);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const rates: Record<string, Record<string, { price: number; currency: string }>> = {};
  data?.forEach((row) => {
    if (!row.listing_id || !row.date || row.price == null) return;
    const iso = row.date.slice(0, 10);
    if (!rates[row.listing_id]) {
      rates[row.listing_id] = {};
    }
    rates[row.listing_id][iso] = {
      price: row.price,
      currency: row.currency ?? "GBP",
    };
  });

  return res.status(200).json({ rates });
}
