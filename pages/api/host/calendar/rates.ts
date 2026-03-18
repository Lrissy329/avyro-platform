import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { formatLocalDate, rangeToDates, startOfDay } from "@/lib/dateUtils";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

const toDate = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return startOfDay(parsed);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authClient = createPagesServerClient({ req, res });
  const {
    data: { session },
    error: sessionError,
  } = await authClient.auth.getSession();

  if (sessionError || !session) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const userId = session.user.id;

  const getSupabaseClient = () => {
    try {
      return getSupabaseServerClient();
    } catch (err) {
      console.warn("[api/host/calendar/rates] falling back to authed client", err);
      return authClient;
    }
  };

  if (req.method === "GET") {
    try {
      const { start, end, listingId } = req.query;
      if (!start || !end || !listingId) {
        return res.status(200).json({ rates: {}, overrides: [] });
      }

      const listingIds = (Array.isArray(listingId) ? listingId : [listingId])
        .map((id) => String(id))
        .filter(Boolean);
      if (!listingIds.length) {
        return res.status(200).json({ rates: {}, overrides: [] });
      }

      const supabase = getSupabaseClient();
      const { data: ownedListings, error: ownedListingsError } = await supabase
        .from("listings")
        .select("id")
        .eq("user_id", userId)
        .in("id", listingIds);

      if (ownedListingsError) {
        console.error("[api/host/calendar/rates] owner listing query error", ownedListingsError);
        return res.status(500).json({ error: "Failed to load listings." });
      }

      const allowedListingIds = (ownedListings ?? []).map((row) => row.id).filter(Boolean);
      if (!allowedListingIds.length) {
        return res.status(200).json({ rates: {}, overrides: [] });
      }

      const { data, error } = await supabase
        .from("nightly_rates")
        .select("listing_id, date, price, currency")
        .gte("date", start as string)
        .lte("date", end as string)
        .in("listing_id", allowedListingIds);

      if (error) {
        console.error("[api/host/calendar/rates] query error", error);
        return res.status(200).json({ rates: {}, overrides: [] });
      }

      const rates: Record<string, Record<string, { price: number; currency: string }>> = {};
      data?.forEach((row) => {
        if (!row.listing_id || !row.date || row.price == null) return;
        const iso = row.date.slice(0, 10);
        if (!rates[row.listing_id]) rates[row.listing_id] = {};
        rates[row.listing_id][iso] = {
          price: row.price,
          currency: row.currency ?? "GBP",
        };
      });

      return res.status(200).json({ rates, overrides: data ?? [] });
    } catch (err: any) {
      console.error("[api/host/calendar/rates] unexpected error", err);
      return res.status(200).json({ rates: {}, overrides: [] });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { listingId, startDate, endDate, nightlyRate, nightlyRatePence } = req.body ?? {};

  if (!listingId || !startDate || !endDate || (nightlyRate == null && nightlyRatePence == null)) {
    return res
      .status(400)
      .json({ error: "listingId, startDate, endDate, nightlyRate are required." });
  }

  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) {
    return res.status(400).json({ error: "Invalid startDate or endDate." });
  }

  const rate = Number(
    nightlyRate != null ? nightlyRate : Number(nightlyRatePence) / 100
  );
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ error: "nightlyRate must be a positive number." });
  }
  const listingIdValue = String(listingId);

  const dates = rangeToDates(start, end);
  const supabase = getSupabaseClient();

  const { data: ownedListing, error: ownedListingError } = await supabase
    .from("listings")
    .select("id")
    .eq("id", listingIdValue)
    .eq("user_id", userId)
    .maybeSingle();

  if (ownedListingError) {
    console.error("[api/host/calendar/rates] owner lookup error", ownedListingError);
    return res.status(500).json({ error: "Failed to verify listing ownership." });
  }

  if (!ownedListing?.id) {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    await Promise.all(
      dates.map(async (date) => {
        const { error } = await supabase
          .from("nightly_rates")
          .upsert(
            {
              listing_id: listingIdValue,
              date: formatLocalDate(date),
              price: rate,
              currency: "GBP",
            },
            { onConflict: "listing_id,date" }
          );
        if (error) throw error;
      })
    );
  } catch (error: any) {
    console.error("[api/host/calendar/rates] update error", error);
    return res.status(500).json({ error: error?.message ?? "Failed to update rates." });
  }

  return res.status(200).json({ ok: true });
}
