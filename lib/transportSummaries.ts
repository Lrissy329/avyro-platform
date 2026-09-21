// Adds saved airport travel times (listing_transport_summaries) to listing rows for search and the homepage.
//
// Those pages used to read commute columns straight off `listings` (drive_minutes_offpeak, taxi_typical_minutes,
// ...). Those columns do not exist in the live database -- the numbers live in listing_transport_summaries --
// so every card fell back to "Near STN". This merges the saved numbers in under the same field names the
// pages already understand. Any failure returns the rows untouched: a missing time must never hide a listing.

type ListingRowLike = { id?: unknown; primary_poi_id?: unknown; [key: string]: unknown };

const SUMMARY_COLUMNS =
  "listing_id, poi_id, taxi_typical_minutes, taxi_duration_minutes, taxi_buffer_minutes, public_transport_typical_minutes, public_transport_duration_minutes, public_transport_buffer_minutes, public_transport_modes";

export async function withTransportSummaries<T extends ListingRowLike>(
  client: { from: (table: string) => any },
  rows: T[]
): Promise<T[]> {
  const ids = rows.map((row) => (typeof row.id === "string" ? row.id : null)).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return rows;

  try {
    const { data, error } = await client
      .from("listing_transport_summaries")
      .select(SUMMARY_COLUMNS)
      .in("listing_id", ids);
    if (error || !Array.isArray(data) || data.length === 0) return rows;

    return rows.map((row) => {
      const candidates = data.filter((summary: any) => summary.listing_id === row.id);
      if (candidates.length === 0) return row;
      // Prefer the summary for the listing's own airport; otherwise take the first one saved.
      const match =
        candidates.find((summary: any) => row.primary_poi_id && summary.poi_id === row.primary_poi_id) ??
        candidates[0];
      const merged: Record<string, unknown> = { ...row };
      for (const key of [
        "taxi_typical_minutes",
        "taxi_duration_minutes",
        "taxi_buffer_minutes",
        "public_transport_typical_minutes",
        "public_transport_duration_minutes",
        "public_transport_buffer_minutes",
      ]) {
        // Never overwrite a value the listing row already carries.
        if (merged[key] == null && match[key] != null) merged[key] = match[key];
      }
      return merged as T;
    });
  } catch {
    return rows;
  }
}
