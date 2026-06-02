import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("schema cache") ||
    (message.includes("column") && message.includes("does not exist"))
  );
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = String(req.query.id ?? "").trim();
  if (!id) {
    return res.status(400).json({ error: "Listing id is required." });
  }

  const supabase = getSupabaseServerClient();
  const selects = [
    "id, user_id, title, description, location, airport_code, primary_poi_id, rental_type, booking_unit, price_per_night, price_per_hour, price_per_week, price_per_month, price_overrides, bathrooms, beds, type, photos, amenities, latitude, longitude, allow_flexible_stays, flexible_stay_mode, flex_min_commitment_nights, flex_max_extension_nights, flex_extension_notice_hours, flex_extension_pricing_mode, flex_rolling_window_days, flex_pricing_multiplier, is_shared_stay, shared_total_spots, shared_weekly_price_pence, shared_join_mode, shared_min_weeks, shared_max_weeks",
    "id, user_id, title, description, location, airport_code, primary_poi_id, rental_type, booking_unit, price_per_night, price_per_hour, price_per_week, price_per_month, price_overrides, bathrooms, beds, type, photos, amenities, latitude, longitude, allow_flexible_stays, flex_max_extension_nights, is_shared_stay, shared_total_spots, shared_weekly_price_pence, shared_join_mode, shared_min_weeks, shared_max_weeks",
    "id, user_id, title, description, location, airport_code, primary_poi_id, rental_type, booking_unit, price_per_night, price_per_hour, price_per_week, price_per_month, price_overrides, bathrooms, beds, type, photos, amenities, latitude, longitude, is_shared_stay, shared_total_spots, shared_weekly_price_pence, shared_join_mode, shared_min_weeks, shared_max_weeks",
    "id, user_id, title, description, location, airport_code, primary_poi_id, rental_type, booking_unit, price_per_night, price_per_hour, price_per_week, price_per_month, price_overrides, bathrooms, beds, type, photos, amenities, latitude, longitude",
  ];

  let row: any = null;
  let error: any = null;
  for (const select of selects) {
    const result = await supabase.from("listings").select(select).eq("id", id).maybeSingle();
    row = result.data ?? null;
    error = result.error;
    if (!error) break;
    if (!isMissingColumn(error)) break;
  }

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!row) {
    return res.status(404).json({ error: "Listing not found." });
  }

  return res.status(200).json({
    ...row,
    allow_flexible_stays: row.allow_flexible_stays ?? false,
    flexible_stay_mode:
      row.allow_flexible_stays === false ? "none" : row.flexible_stay_mode ?? "none",
    flex_min_commitment_nights: row.flex_min_commitment_nights ?? 7,
    flex_max_extension_nights: row.flex_max_extension_nights ?? 7,
    flex_extension_notice_hours: row.flex_extension_notice_hours ?? 24,
    flex_extension_pricing_mode: row.flex_extension_pricing_mode ?? "same_rate",
    flex_rolling_window_days: row.flex_rolling_window_days ?? 3,
    flex_pricing_multiplier: row.flex_pricing_multiplier ?? 1.1,
    is_shared_stay: row.is_shared_stay ?? false,
    shared_total_spots: row.shared_total_spots ?? null,
    shared_weekly_price_pence: row.shared_weekly_price_pence ?? null,
    shared_join_mode: row.shared_join_mode ?? "open",
    shared_min_weeks: row.shared_min_weeks ?? 1,
    shared_max_weeks: row.shared_max_weeks ?? 12,
  });
}
