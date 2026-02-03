import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase service role configuration for bookings API.");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Booking id is required" });
  }

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      `
      id,
      listing_id,
      status,
      payout_status,
      check_in_time,
      check_out_time,
      stay_type,
      channel,
      price_total,
      currency
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[api/bookings] failed to fetch booking", error);
    return res.status(500).json({ error: "Unable to load booking." });
  }

  if (!data) {
    return res.status(404).json({ error: "Booking not found." });
  }

  let listing = null;
  if (data.listing_id) {
    const { data: listingRow, error: listingError } = await supabaseAdmin
      .from("listings")
      .select("id, title, location, photos")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (listingError) {
      console.warn("[api/bookings] failed to fetch listing", listingError);
    } else {
      listing = listingRow;
    }
  }

  const booking = {
    ...data,
    check_in: data.check_in_time,
    check_out: data.check_out_time,
    listing,
  };

  return res.status(200).json({ booking });
}
