import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { addDays, formatLocalDate, startOfDay } from "@/lib/dateUtils";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42p01" ||
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("relation") ||
    message.includes("schema cache") ||
    (message.includes("column") && message.includes("does not exist"))
  );
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

const logFeedError = (details: {
  stage: string;
  userId?: string;
  start?: string;
  end?: string;
  listingId?: string;
  queryError?: any;
  extra?: Record<string, unknown>;
}) => {
  try {
    console.error(
      "HOST_CALENDAR_FEED_ERROR\n" +
        JSON.stringify(
          {
            stage: details.stage,
            userId: details.userId ?? null,
            start: details.start ?? null,
            end: details.end ?? null,
            listingId: details.listingId ?? null,
            queryError: details.queryError
              ? {
                  code: details.queryError?.code ?? null,
                  message: details.queryError?.message ?? String(details.queryError),
                  details: details.queryError?.details ?? null,
                  hint: details.queryError?.hint ?? null,
                }
              : null,
            extra: details.extra ?? null,
          },
          null,
          2
        )
    );
  } catch (error) {
    console.error("HOST_CALENDAR_FEED_ERROR", details, error);
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const queryStart = String(req.query.start ?? "");
  const queryEnd = String(req.query.end ?? "");
  const queryListingId = String(req.query.listingId ?? "");

  try {
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
      logFeedError({
        stage: "listings_query",
        userId,
        start: queryStart,
        end: queryEnd,
        listingId: queryListingId,
        queryError: listingsError,
      });
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
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, host_net_total_pence, guest_full_name, stay_type, flex_mode, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, host_net_total_pence, guest_full_name, stay_type, flex_mode, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, host_net_total_pence, guest_full_name, stay_type, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, host_net_total_pence, guest_full_name, stay_type",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, guest_full_name, stay_type, flex_mode, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, guest_full_name, stay_type, flex_mode, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, guest_full_name, stay_type, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, guest_full_name, stay_type",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type, flex_mode, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type, flex_mode, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
    "id, listing_id, guest_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type",
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type, flex_mode, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type, flex_mode, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at",
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence",
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
      logFeedError({
        stage: "bookings_query",
        userId,
        start: queryStart,
        end: queryEnd,
        listingId: queryListingId,
        queryError: bookingsError,
      });
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
      logFeedError({
        stage: "blocks_query",
        userId,
        start: queryStart,
        end: queryEnd,
        listingId: queryListingId,
        queryError: blocksError,
      });
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
        flexMode:
          row.flex_mode != null && String(row.flex_mode).trim().length > 0
            ? String(row.flex_mode).toLowerCase()
            : null,
        flexCurrentConfirmedEnd:
          row.flex_current_confirmed_end != null
            ? String(row.flex_current_confirmed_end).slice(0, 10)
            : null,
        flexMaxEnd:
          row.flex_max_end != null ? String(row.flex_max_end).slice(0, 10) : null,
        flexExtensionCutoffAt:
          row.flex_extension_cutoff_at != null ? String(row.flex_extension_cutoff_at) : null,
        currency: row.currency ?? "GBP",
        flexExtraNight: Boolean(row.flex_extra_night),
        flexExtraNightStatus:
          row.flex_extra_night_status != null
            ? String(row.flex_extra_night_status).toLowerCase()
            : null,
        flexExtraNightPricePence:
          row.flex_extra_night_price_pence != null && Number.isFinite(Number(row.flex_extra_night_price_pence))
            ? Number(row.flex_extra_night_price_pence)
            : null,
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

  const optionalFlexBlocks = bookings
    .filter((booking: any) => booking.bookingType !== "hourly")
    .filter((booking: any) => Boolean(booking.flexExtraNight))
    .filter((booking: any) => {
      const status = String(booking.flexExtraNightStatus ?? "").toLowerCase();
      return status === "reserved";
    })
    .flatMap((booking: any) => {
      const checkout = new Date(booking.end);
      if (!Number.isFinite(checkout.getTime())) return [];
      const startDay = startOfDay(checkout);
      const endDay = addDays(startDay, 1);
      const startMs = startDay.getTime();
      const endMs = endDay.getTime();
      if (!(startMs < rangeEndExclusive && endMs > rangeStart)) return [];

      return [
        {
          id: `flex-${booking.id}`,
          listingId: booking.listingId,
          start: startDay.toISOString(),
          end: endDay.toISOString(),
          reason: "Optional extra night",
          blockType: "flex_optional",
        },
      ];
    });

  const rollingBookingById = bookings.reduce<Record<string, any>>((acc, booking: any) => {
    if (String(booking.flexMode ?? "") !== "rolling") return acc;
    acc[String(booking.id)] = booking;
    return acc;
  }, {});

  const rollingBookingIds = Object.keys(rollingBookingById);
  let rollingHeldBlocks: Array<{
    id: string;
    listingId: string;
    start: string;
    end: string;
    reason: string;
    blockType: string;
    bookingId?: string;
    cutoffAt?: string | null;
    maxEnd?: string | null;
    confirmedEnd?: string | null;
  }> = [];

    if (rollingBookingIds.length > 0) {
      const { data: rollingWindows, error: rollingWindowsError } = await supabase
        .from("booking_flex_windows")
        .select("id, booking_id, start_date, end_date, status, cutoff_at")
        .in("booking_id", rollingBookingIds)
        .eq("status", "held")
        .limit(5000);

      if (rollingWindowsError && !isMissingColumn(rollingWindowsError)) {
        logFeedError({
          stage: "rolling_windows_query",
          userId,
          start: queryStart,
          end: queryEnd,
          listingId: queryListingId,
          queryError: rollingWindowsError,
        });
        return res.status(500).json({ error: rollingWindowsError.message });
      }

    rollingHeldBlocks = (rollingWindows ?? []).flatMap((window: any) => {
      const booking = rollingBookingById[String(window.booking_id)];
      if (!booking?.listingId) return [];
      if (!window.start_date || !window.end_date) return [];

      const startDate = new Date(`${window.start_date}T00:00:00.000Z`);
      const endDate = new Date(`${window.end_date}T00:00:00.000Z`);
      if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return [];
      if (!(startDate.getTime() < rangeEndExclusive && endDate.getTime() > rangeStart)) return [];

      return [
        {
          id: `rolling-held-${window.id}`,
          listingId: booking.listingId,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          reason: "Rolling flex hold",
          blockType: "flex_rolling_held",
          bookingId: String(window.booking_id),
          cutoffAt: window.cutoff_at ? String(window.cutoff_at) : null,
          maxEnd: booking.flexMaxEnd ?? null,
          confirmedEnd: booking.flexCurrentConfirmedEnd ?? null,
        },
      ];
    });
  }

  let sharedGroupBlocks: Array<{
    id: string;
    listingId: string;
    start: string;
    end: string;
    reason: string;
    blockType: "shared_group";
    sharedGroupId: string;
    sharedTotalSpots: number;
    sharedFilledSpots: number;
    sharedPendingSpots: number;
  }> = [];

    const sharedGroupRangeStart = formatLocalDate(start);
    const sharedGroupRangeEndExclusive = formatLocalDate(addDays(end, 1));
    const sharedGroupsWithStatus = await supabase
      .from("shared_groups")
      .select("id, listing_id, start_date, end_date, total_spots, status")
      .in("listing_id", activeListingIds)
      .in("status", ["open", "full"])
      .lt("start_date", sharedGroupRangeEndExclusive)
      .gt("end_date", sharedGroupRangeStart)
      .limit(2000);

    let sharedGroupsResult = sharedGroupsWithStatus;
    if (sharedGroupsWithStatus.error && isMissingColumn(sharedGroupsWithStatus.error)) {
      sharedGroupsResult = await supabase
        .from("shared_groups")
        .select("id, listing_id, start_date, end_date, total_spots, status")
        .in("listing_id", activeListingIds)
        .lt("start_date", sharedGroupRangeEndExclusive)
        .gt("end_date", sharedGroupRangeStart)
        .limit(2000);
    }

    if (sharedGroupsResult.error && !isMissingColumn(sharedGroupsResult.error)) {
      logFeedError({
        stage: "shared_groups_query",
        userId,
        start: queryStart,
        end: queryEnd,
        listingId: queryListingId,
        queryError: sharedGroupsResult.error,
      });
      return res.status(500).json({ error: sharedGroupsResult.error.message });
    }

    const sharedGroups = (sharedGroupsResult.data ?? []).filter((group: any) => {
      const status = String(group?.status ?? "").toLowerCase();
      return !status || status === "open" || status === "full";
    });
  const sharedGroupIds = sharedGroups.map((group: any) => String(group.id)).filter(Boolean);
  const occupancyByGroupId: Record<string, { confirmed: number; pending: number }> = {};
  sharedGroupIds.forEach((id) => {
    occupancyByGroupId[id] = { confirmed: 0, pending: 0 };
  });

  if (sharedGroupIds.length > 0) {
    const membersResult = await supabase
      .from("shared_group_members")
      .select("shared_group_id, status, reservation_expires_at")
      .in("shared_group_id", sharedGroupIds)
      .in("status", ["pending", "confirmed"]);

    let membersRows = membersResult.data ?? [];
      if (membersResult.error && isMissingColumn(membersResult.error)) {
      const membersFallback = await supabase
        .from("shared_group_members")
        .select("shared_group_id, status")
        .in("shared_group_id", sharedGroupIds)
        .in("status", ["pending", "confirmed"]);
        if (membersFallback.error && !isMissingColumn(membersFallback.error)) {
          logFeedError({
            stage: "shared_group_members_fallback_query",
            userId,
            start: queryStart,
            end: queryEnd,
            listingId: queryListingId,
            queryError: membersFallback.error,
          });
          return res.status(500).json({ error: membersFallback.error.message });
        }
      membersRows = membersFallback.data ?? [];
      } else if (membersResult.error && !isMissingColumn(membersResult.error)) {
        logFeedError({
          stage: "shared_group_members_query",
          userId,
          start: queryStart,
          end: queryEnd,
          listingId: queryListingId,
          queryError: membersResult.error,
        });
        return res.status(500).json({ error: membersResult.error.message });
      }

    const nowMs = Date.now();
    membersRows.forEach((row: any) => {
      const groupId = String(row?.shared_group_id ?? "");
      if (!groupId || !occupancyByGroupId[groupId]) return;
      const status = String(row?.status ?? "").toLowerCase();
      if (status === "confirmed") {
        occupancyByGroupId[groupId].confirmed += 1;
        return;
      }
      if (status === "pending") {
        const expiresAt = row?.reservation_expires_at
          ? new Date(String(row.reservation_expires_at)).getTime()
          : Number.POSITIVE_INFINITY;
        if (Number.isFinite(expiresAt) && expiresAt <= nowMs) return;
        occupancyByGroupId[groupId].pending += 1;
      }
    });
  }

    sharedGroupBlocks = sharedGroups.flatMap((group: any) => {
      if (!group?.listing_id || !group?.start_date || !group?.end_date) return [];
      const startDate = new Date(`${group.start_date}T00:00:00.000Z`);
      const endDate = new Date(`${group.end_date}T00:00:00.000Z`);
      if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return [];
      if (!(startDate.getTime() < rangeEndExclusive && endDate.getTime() > rangeStart)) return [];
      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();
    const occupancy = occupancyByGroupId[String(group.id)] ?? { confirmed: 0, pending: 0 };
    const totalSpots = Math.max(1, Number(group.total_spots ?? 1));
    const occupiedSpots = occupancy.confirmed + occupancy.pending;

    return [
      {
        id: `shared-group-${group.id}`,
        listingId: String(group.listing_id),
        start: startIso,
        end: endIso,
        reason: `Shared group ${occupiedSpots}/${totalSpots} filled`,
        blockType: "shared_group" as const,
        sharedGroupId: String(group.id),
        sharedTotalSpots: totalSpots,
        sharedFilledSpots: occupancy.confirmed,
        sharedPendingSpots: occupancy.pending,
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
      logFeedError({
        stage: "rates_query",
        userId,
        start: queryStart,
        end: queryEnd,
        listingId: queryListingId,
        queryError: ratesError,
      });
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
      blocks: [...blocks, ...optionalFlexBlocks, ...rollingHeldBlocks, ...sharedGroupBlocks],
      rates,
    });
  } catch (error: any) {
    logFeedError({
      stage: "unexpected_exception",
      start: queryStart,
      end: queryEnd,
      listingId: queryListingId,
      queryError: error,
    });
    return res.status(500).json({ error: "Unable to load calendar feed." });
  }
}
