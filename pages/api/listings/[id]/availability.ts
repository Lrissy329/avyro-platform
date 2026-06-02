import type { NextApiRequest, NextApiResponse } from "next";

import {
  evaluateFlexAvailability,
  loadUnavailableNightSets,
  type FlexMode,
} from "@/lib/flexAvailability";
import { addDaysUtc, toUtcDateOnly, toUtcDateOnlyString } from "@/lib/flexStay";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type AvailabilityResponse = {
  listing_id: string;
  from: string;
  to: string;
  booked: string[];
  blocked: string[];
  held: string[];
  baseAvailable: boolean;
  extraNightAvailable: boolean;
  rollingFlexAvailable: boolean;
  rollingFlexWindowDaysAvailable: number;
  rollingFlexMaxExtensionNightsSupported: number;
  generated_at: string;
};

const MAX_RANGE_DAYS = 120;
const isMissingRelation = (error: any) => {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42p01" ||
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("relation") ||
    (message.includes("column") && message.includes("does not exist"))
  );
};
const ENABLE_AVAILABILITY_DEBUG =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEBUG_AVAILABILITY === "1";

const parseDayKey = (value: string) => toUtcDateOnly(value);
const markRangeDays = (
  startDate: Date,
  endDateExclusive: Date,
  target: Set<string>,
  clampStart: Date,
  clampEndExclusive: Date,
  skip: Set<string>
) => {
  const start =
    startDate.getTime() > clampStart.getTime() ? startDate : clampStart;
  const end =
    endDateExclusive.getTime() < clampEndExclusive.getTime()
      ? endDateExclusive
      : clampEndExclusive;
  if (end.getTime() <= start.getTime()) return;

  for (let cursor = new Date(start); cursor < end; cursor = addDaysUtc(cursor, 1)) {
    const key = toUtcDateOnlyString(cursor);
    if (!skip.has(key)) {
      target.add(key);
    }
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AvailabilityResponse | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Listing id is required." });
  }

  const fromParam = typeof req.query.from === "string" ? req.query.from : null;
  const toParam = typeof req.query.to === "string" ? req.query.to : null;
  const checkInParam = typeof req.query.checkIn === "string" ? req.query.checkIn : null;
  const checkOutParam = typeof req.query.checkOut === "string" ? req.query.checkOut : null;

  if (!fromParam || !toParam) {
    return res.status(400).json({ error: "`from` and `to` are required." });
  }

  const windowStart = parseDayKey(fromParam);
  const windowEnd = parseDayKey(toParam);

  if (!windowStart || !windowEnd) {
    return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
  }

  if (windowEnd <= windowStart) {
    return res.status(400).json({ error: "`to` must be after `from`." });
  }

  const diffDays = Math.ceil((windowEnd.getTime() - windowStart.getTime()) / 86400000);
  if (diffDays > MAX_RANGE_DAYS) {
    return res.status(400).json({ error: "Date window too large." });
  }

  try {
    const normalizedFrom = toUtcDateOnlyString(windowStart);
    const normalizedTo = toUtcDateOnlyString(windowEnd);
    if (ENABLE_AVAILABILITY_DEBUG) {
      console.log(
        "LISTING_AVAILABILITY_REQUEST\n" +
          JSON.stringify(
            {
              listing_id: id,
              from: normalizedFrom,
              to: normalizedTo,
              filters: {
                nightly_only: true,
                active_statuses_only: true,
                include_manual_blocks: true,
                include_flex_held_dates: true,
              },
            },
            null,
            2
          )
      );
    }

    const supabase = getSupabaseServerClient();
    const listingSelects = [
      "id, is_shared_stay, shared_total_spots, allow_flexible_stays, flexible_stay_mode, flex_rolling_window_days, flex_max_extension_nights",
      "id, is_shared_stay, shared_total_spots, allow_flexible_stays",
      "id, is_shared_stay, shared_total_spots",
      "id",
    ];

    let listingRow: any = null;
    let listingError: any = null;
    for (const select of listingSelects) {
      const result = await supabase
        .from("listings")
        .select(select)
        .eq("id", id)
        .maybeSingle();
      listingRow = result.data ?? null;
      listingError = result.error;
      if (!listingError) break;
      if (!isMissingRelation(listingError)) break;
    }

    if (listingError) {
      return res.status(500).json({ error: listingError.message ?? "Failed to load listing flex settings." });
    }
    const isSharedStayListing = Boolean((listingRow as any)?.is_shared_stay);

    const { booked, blocked, held } = await loadUnavailableNightSets({
      supabase,
      listingId: id,
      windowStartDate: windowStart,
      windowEndDateExclusive: windowEnd,
      ignoreSharedGroupBookings: isSharedStayListing,
    });

    if (isSharedStayListing) {
      const sharedGroupsResult = await supabase
        .from("shared_groups")
        .select("id, start_date, end_date, total_spots, status")
        .eq("listing_id", id)
        .in("status", ["open", "full", "closed"])
        .lt("start_date", normalizedTo)
        .gt("end_date", normalizedFrom)
        .limit(500);

      if (sharedGroupsResult.error && !isMissingRelation(sharedGroupsResult.error)) {
        return res.status(500).json({ error: sharedGroupsResult.error.message ?? "Failed to load shared groups." });
      }

      const groups = sharedGroupsResult.data ?? [];
      const groupIds = groups.map((group: any) => String(group.id)).filter(Boolean);
      const occupancyByGroup: Record<string, { confirmed: number; pending: number }> = {};
      groupIds.forEach((groupId) => {
        occupancyByGroup[groupId] = { confirmed: 0, pending: 0 };
      });

      if (groupIds.length > 0) {
        const membersResult = await supabase
          .from("shared_group_members")
          .select("shared_group_id, status, reservation_expires_at")
          .in("shared_group_id", groupIds)
          .in("status", ["pending", "confirmed"]);

        let members: any[] = membersResult.data ?? [];
        if (membersResult.error && isMissingRelation(membersResult.error)) {
          const membersFallback = await supabase
            .from("shared_group_members")
            .select("shared_group_id, status")
            .in("shared_group_id", groupIds)
            .in("status", ["pending", "confirmed"]);
          if (membersFallback.error && !isMissingRelation(membersFallback.error)) {
            return res.status(500).json({ error: membersFallback.error.message ?? "Failed to load shared group members." });
          }
          members = membersFallback.data ?? [];
        } else if (membersResult.error && !isMissingRelation(membersResult.error)) {
          return res.status(500).json({ error: membersResult.error.message ?? "Failed to load shared group members." });
        }

        const nowMs = Date.now();
        members.forEach((member: any) => {
          const groupId = String(member?.shared_group_id ?? "");
          if (!groupId || !occupancyByGroup[groupId]) return;
          const status = String(member?.status ?? "").toLowerCase();
          if (status === "confirmed") {
            occupancyByGroup[groupId].confirmed += 1;
            return;
          }
          if (status === "pending") {
            const expiresAt = member?.reservation_expires_at
              ? new Date(String(member.reservation_expires_at)).getTime()
              : Number.POSITIVE_INFINITY;
            if (Number.isFinite(expiresAt) && expiresAt <= nowMs) return;
            occupancyByGroup[groupId].pending += 1;
          }
        });
      }

      groups.forEach((group: any) => {
        const start = parseDayKey(String(group?.start_date ?? ""));
        const end = parseDayKey(String(group?.end_date ?? ""));
        if (!start || !end || end <= start) return;
        const status = String(group?.status ?? "").toLowerCase();
        const totalSpots = Math.max(1, Math.round(Number(group?.total_spots ?? 1)) || 1);
        const occupancy = occupancyByGroup[String(group?.id ?? "")] ?? { confirmed: 0, pending: 0 };
        const occupied = occupancy.confirmed + occupancy.pending;
        const isClosed = status === "closed";
        const isFull = status === "full" || occupied >= totalSpots;
        if (!isClosed && !isFull) return;
        markRangeDays(start, end, blocked, windowStart, windowEnd, booked);
      });
    }

    const listingAllowsFlexibleStays = (listingRow as any)?.allow_flexible_stays ?? false;
    const configuredMode = String((listingRow as any)?.flexible_stay_mode ?? "").toLowerCase();
    const listingFlexMode: FlexMode =
      !listingAllowsFlexibleStays
        ? "none"
        : configuredMode === "rolling"
        ? "rolling"
        : configuredMode === "extra_night"
        ? "extra_night"
        : "none";
    const supportsFlexibleModes = listingAllowsFlexibleStays && listingFlexMode !== "none";
    const supportsExtraNight = supportsFlexibleModes;
    const supportsRolling = supportsFlexibleModes;
    const rollingWindowDays = Math.max(
      1,
      Math.round(Number((listingRow as any)?.flex_rolling_window_days ?? 3)) || 3
    );
    const rollingMaxExtensionNights = Math.max(
      0,
      Math.round(Number((listingRow as any)?.flex_max_extension_nights ?? 14)) || 14
    );

    let baseAvailable = false;
    let extraNightAvailable = false;
    let rollingFlexAvailable = false;
    let rollingFlexWindowDaysAvailable = 0;
    let rollingFlexMaxExtensionNightsSupported = 0;

    if (checkInParam && checkOutParam) {
      const evaluated = await evaluateFlexAvailability({
        supabase,
        listingId: id,
        checkIn: checkInParam,
        checkOut: checkOutParam,
        config: {
          listingAllowsFlexibleStays,
          flexMode: listingFlexMode,
          rollingWindowDays,
          rollingMaxExtensionNights,
          supportsExtraNight,
          supportsRolling,
        },
      });
      baseAvailable = evaluated.baseAvailable;
      extraNightAvailable = evaluated.extraNightAvailable;
      rollingFlexAvailable = evaluated.rollingFlexAvailable;
      rollingFlexWindowDaysAvailable = evaluated.rollingFlexWindowDaysAvailable;
      rollingFlexMaxExtensionNightsSupported =
        evaluated.rollingFlexMaxExtensionNightsSupported;
    }

    const responsePayload: AvailabilityResponse = {
      listing_id: id,
      from: normalizedFrom,
      to: normalizedTo,
      booked: Array.from(booked).sort(),
      blocked: Array.from(blocked).sort(),
      held: Array.from(held).sort(),
      baseAvailable,
      extraNightAvailable,
      rollingFlexAvailable,
      rollingFlexWindowDaysAvailable,
      rollingFlexMaxExtensionNightsSupported,
      generated_at: new Date().toISOString(),
    };

    if (ENABLE_AVAILABILITY_DEBUG) {
      console.log(
        "LISTING_AVAILABILITY_RESPONSE\n" +
          JSON.stringify(
            {
              listing_id: id,
              from: responsePayload.from,
              to: responsePayload.to,
              booked_count: responsePayload.booked.length,
              blocked_count: responsePayload.blocked.length,
              held_count: responsePayload.held.length,
              is_shared_stay: isSharedStayListing,
              flex_mode_active: listingFlexMode !== "none",
              flex_mode: listingFlexMode,
              baseAvailable: responsePayload.baseAvailable,
              extraNightAvailable: responsePayload.extraNightAvailable,
              rollingFlexAvailable: responsePayload.rollingFlexAvailable,
              rollingFlexWindowDaysAvailable:
                responsePayload.rollingFlexWindowDaysAvailable,
              rollingFlexMaxExtensionNightsSupported:
                responsePayload.rollingFlexMaxExtensionNightsSupported,
            },
            null,
            2
          )
      );
    }

    return res.status(200).json(responsePayload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Failed to load availability." });
  }
}
