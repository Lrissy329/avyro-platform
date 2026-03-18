import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { addDays, formatLocalDate, startOfDay } from "@/lib/dateUtils";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

const toDay = (value: unknown) => {
  const parsed = new Date(String(value ?? ""));
  if (!Number.isFinite(parsed.getTime())) return null;
  return startOfDay(parsed);
};

const toBool = (value: unknown) => {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const getSupabaseClient = (authClient: any) => {
  try {
    return getSupabaseServerClient();
  } catch {
    return authClient;
  }
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

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const start = toDay(req.query.start);
  const end = toDay(req.query.end);
  if (!start || !end) {
    return res.status(400).json({ error: "start and end are required (YYYY-MM-DD)." });
  }

  const includeCancelled = toBool(req.query.includeCancelled);
  const listingIdFilter = String(req.query.listingId ?? "").trim();
  const rangeStart = start.getTime();
  const rangeEndExclusive = addDays(end, 1).getTime();
  const userId = session.user.id;

  const supabase = getSupabaseClient(authClient);

  let listingRows: any[] = [];
  let listingsError: any = null;
  const listingSelects = [
    "id, title, location, booking_unit",
    "id, title, booking_unit",
    "id, title",
  ];

  for (const select of listingSelects) {
    const query = supabase
      .from("listings")
      .select(select)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);

    const result = await query;
    listingRows = result.data ?? [];
    listingsError = result.error;

    if (!listingsError) break;
    if (!isMissingColumn(listingsError)) break;
  }

  if (listingsError) {
    return res.status(500).json({ error: listingsError.message });
  }

  const listingIds = listingRows.map((row) => row.id).filter(Boolean);
  if (!listingIds.length) {
    return res.status(200).json({ listings: [], bookings: [], blocks: [], rates: {} });
  }
  const activeListingIds =
    listingIdFilter && listingIdFilter !== "all"
      ? listingIds.filter((id) => id === listingIdFilter)
      : listingIds;

  if (!activeListingIds.length) {
    return res.status(200).json({
      listings: listingRows.map((row) => ({
        id: String(row.id),
        title: row.title?.trim() || "Listing",
        address: row.location ?? undefined,
        hourlyEnabled: String(row.booking_unit ?? "").toLowerCase() === "hourly",
      })),
      bookings: [],
      blocks: [],
      rates: {},
    });
  }

  let bookingRows: any[] = [];
  let bookingsError: any = null;
  const bookingSelects = [
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, host_net_total_pence, guest_full_name, stay_type",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, guest_full_name, stay_type",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type",
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type",
  ];

  for (const select of bookingSelects) {
    let query = supabase
      .from("bookings")
      .select(select)
      .in("listing_id", activeListingIds)
      .order("check_in_time", { ascending: true })
      .limit(1000);

    if (!includeCancelled) {
      query = query.neq("status", "cancelled");
    }

    const result = await query;
    bookingRows = result.data ?? [];
    bookingsError = result.error;

    if (!bookingsError) break;
    if (!isMissingColumn(bookingsError)) break;
  }

  if (bookingsError) {
    return res.status(500).json({ error: bookingsError.message });
  }

  const guestIds = Array.from(
    new Set(
      (bookingRows ?? [])
        .map((row) => (typeof row?.guest_id === "string" ? row.guest_id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const guestNameById: Record<string, string> = {};
  if (guestIds.length) {
    const { data: profileRows, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", guestIds);

    if (!profilesError) {
      (profileRows ?? []).forEach((row: any) => {
        if (typeof row?.id !== "string") return;
        const name = typeof row?.full_name === "string" ? row.full_name.trim() : "";
        if (!name) return;
        guestNameById[row.id] = name;
      });
    }
  }

  let blockRows: any[] = [];
  let blocksError: any = null;
  const blockSelects = [
    "id, listing_id, start_date, end_date, start_at, end_at, source, label, notes",
    "id, listing_id, start_date, end_date, source, label, notes",
    "id, listing_id, start_date, end_date, source, label",
  ];

  for (const select of blockSelects) {
    const result = await supabase
      .from("listing_calendar_blocks")
      .select(select)
      .in("listing_id", activeListingIds)
      .order("start_date", { ascending: true })
      .limit(2000);

    blockRows = result.data ?? [];
    blocksError = result.error;
    if (!blocksError) break;
    if (!isMissingColumn(blocksError)) break;
  }

  if (blocksError) {
    return res.status(500).json({ error: blocksError.message });
  }

  const listingBookingUnits = listingRows.reduce<Record<string, string | null>>((acc, listing) => {
    if (listing.id) acc[listing.id] = listing.booking_unit ?? null;
    return acc;
  }, {});

  const bookings = (bookingRows ?? [])
    .filter((row) => row.listing_id && row.check_in_time && row.check_out_time)
    .filter((row) => {
      const bookingStart = new Date(row.check_in_time).getTime();
      const bookingEnd = new Date(row.check_out_time).getTime();
      if (!Number.isFinite(bookingStart) || !Number.isFinite(bookingEnd)) return false;
      return bookingStart < rangeEndExclusive && bookingEnd > rangeStart;
    })
    .map((row) => {
      const stayType = String(row.stay_type ?? "").toLowerCase();
      const hourlyFromType = stayType === "day_use" || stayType === "split_rest" || stayType === "hourly";
      const hourlyFromListing = listingBookingUnits[row.listing_id] === "hourly";
      const bookingType = hourlyFromType || hourlyFromListing ? "hourly" : "nightly";

      const total = Number(row.price_total);
      const totalPence = Number.isFinite(total) ? Math.round(total * 100) : undefined;

      return {
        id: String(row.id),
        listingId: String(row.listing_id),
        guestName:
          (typeof row.guest_full_name === "string" && row.guest_full_name.trim().length > 0
            ? row.guest_full_name.trim()
            : null) ??
          (typeof row.guest_id === "string" ? guestNameById[row.guest_id] ?? null : null),
        start: new Date(row.check_in_time).toISOString(),
        end: new Date(row.check_out_time).toISOString(),
        channel: row.channel ?? "direct",
        status: row.status ?? "confirmed",
        totalPence,
        payoutEstimatePence:
          row.host_net_total_pence != null && Number.isFinite(Number(row.host_net_total_pence))
            ? Number(row.host_net_total_pence)
            : undefined,
        bookingType,
        currency: row.currency ?? "GBP",
      };
    });

  const blocks = (blockRows ?? [])
    .filter((row) => row.listing_id)
    .flatMap((row) => {
      if (row.start_at && row.end_at) {
        const startAt = new Date(row.start_at).getTime();
        const endAt = new Date(row.end_at).getTime();
        if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return [];
        if (!(startAt < rangeEndExclusive && endAt > rangeStart)) return [];
        return [
          {
            id: String(row.id),
            listingId: String(row.listing_id),
            start: new Date(row.start_at).toISOString(),
            end: new Date(row.end_at).toISOString(),
            reason: row.notes ?? row.label ?? "Blocked",
            blockType: "hourly",
          },
        ];
      }

      if (!row.start_date || !row.end_date) return [];
      const blockStart = new Date(`${row.start_date}T00:00:00`).getTime();
      const blockEndExclusiveDate = addDays(new Date(`${row.end_date}T00:00:00`), 1);
      const blockEndExclusive = blockEndExclusiveDate.getTime();
      if (!(blockStart < rangeEndExclusive && blockEndExclusive > rangeStart)) return [];

      return [
        {
          id: String(row.id),
          listingId: String(row.listing_id),
          start: new Date(`${row.start_date}T00:00:00`).toISOString(),
          end: blockEndExclusiveDate.toISOString(),
          reason: row.notes ?? row.label ?? "Blocked",
          blockType: "nightly",
        },
      ];
    });

  const { data: rateRows, error: ratesError } = await supabase
    .from("nightly_rates")
    .select("listing_id, date, price")
    .in("listing_id", activeListingIds)
    .gte("date", formatLocalDate(start))
    .lte("date", formatLocalDate(end));

  if (ratesError && !isMissingColumn(ratesError)) {
    return res.status(500).json({ error: ratesError.message });
  }

  const rates: Record<string, Record<string, number>> = {};
  (rateRows ?? []).forEach((row: any) => {
    if (!row?.listing_id || !row?.date || row?.price == null) return;
    if (!rates[row.listing_id]) rates[row.listing_id] = {};
    rates[row.listing_id][String(row.date).slice(0, 10)] = Number(row.price);
  });

  const listings = listingRows.map((row) => ({
    id: String(row.id),
    title: row.title?.trim() || "Listing",
    address: row.location ?? undefined,
    hourlyEnabled: String(row.booking_unit ?? "").toLowerCase() === "hourly",
  }));

  return res.status(200).json({
    listings,
    bookings,
    blocks,
    rates,
  });
}
