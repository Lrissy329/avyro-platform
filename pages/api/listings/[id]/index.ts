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

const ENABLE_SHARED_LISTING_DETAIL_DEBUG =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEBUG_SHARED_LISTING_DETAIL === "1";

const debugLog = (payload: Record<string, unknown>) => {
  if (!ENABLE_SHARED_LISTING_DETAIL_DEBUG) return;
  console.log(`SHARED_LISTING_DETAIL_DEBUG\n${JSON.stringify(payload, null, 2)}`);
};

const extractMissingColumns = (error: any): string[] => {
  const texts = [
    String(error?.message ?? ""),
    String(error?.details ?? ""),
    String(error?.hint ?? ""),
  ];
  const columns = new Set<string>();
  const patterns = [
    /could not find the ['"`]([a-z0-9_]+)['"`] column of ['"`]listings['"`] in the schema cache/gi,
    /column\s+listings\.([a-z0-9_]+)\s+does not exist/gi,
    /column\s+["'`]?([a-z0-9_]+)["'`]?\s+does not exist/gi,
  ];

  for (const text of texts) {
    for (const pattern of patterns) {
      let match = pattern.exec(text);
      while (match) {
        if (match[1]) columns.add(String(match[1]).toLowerCase());
        match = pattern.exec(text);
      }
      pattern.lastIndex = 0;
    }
  }

  return Array.from(columns);
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
  let selectFields = [
    "id",
    "user_id",
    "title",
    "description",
    "location",
    "airport_code",
    "primary_poi_id",
    "rental_type",
    "booking_unit",
    "price_per_night",
    "price_per_hour",
    "price_per_week",
    "price_per_month",
    "price_overrides",
    "bathrooms",
    "beds",
    "type",
    "photos",
    "amenities",
    "latitude",
    "longitude",
    "allow_flexible_stays",
    "flexible_stay_mode",
    "flex_min_commitment_nights",
    "flex_max_extension_nights",
    "flex_extension_notice_hours",
    "flex_extension_pricing_mode",
    "flex_rolling_window_days",
    "flex_pricing_multiplier",
    "is_shared_stay",
    "shared_total_spots",
    "shared_weekly_price_pence",
    "shared_join_mode",
    "shared_min_weeks",
    "shared_max_weeks",
  ];

  let row: any = null;
  let error: any = null;
  let attempt = 0;
  const maxAttempts = 20;
  while (attempt < maxAttempts && selectFields.length > 0) {
    const select = selectFields.join(", ");
    const result = await supabase.from("listings").select(select).eq("id", id).maybeSingle();
    row = result.data ?? null;
    error = result.error;
    if (!error) {
      break;
    }
    if (!isMissingColumn(error)) {
      break;
    }
    const missingColumns = extractMissingColumns(error).filter((column) =>
      selectFields.includes(column)
    );
    debugLog({
      listing_id: id,
      stage: "listing_select_retry",
      missing_columns: missingColumns,
      attempted_fields: selectFields,
      error_message: error?.message ?? null,
    });
    if (missingColumns.length === 0) {
      break;
    }
    selectFields = selectFields.filter((field) => !missingColumns.includes(field));
    attempt += 1;
  }

  if (error) {
    debugLog({
      listing_id: id,
      stage: "listing_select_failed",
      error_message: error?.message ?? null,
      remaining_fields: selectFields,
    });
    return res.status(500).json({ error: error.message });
  }
  if (!row) {
    return res.status(404).json({ error: "Listing not found." });
  }

  debugLog({
    listing_id: id,
    stage: "listing_select_success",
    listing_type: row.is_shared_stay ? "shared" : row.allow_flexible_stays ? "flexible" : "standard",
    nullable_fields: {
      price_per_night: row.price_per_night ?? null,
      price_per_hour: row.price_per_hour ?? null,
      shared_weekly_price_pence: row.shared_weekly_price_pence ?? null,
      shared_total_spots: row.shared_total_spots ?? null,
      primary_poi_id: row.primary_poi_id ?? null,
    },
  });

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
