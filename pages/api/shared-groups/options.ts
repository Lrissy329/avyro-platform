import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";
import { getSharedStayWeeks, normalizeSharedJoinMode, parseIsoDateOnly } from "@/lib/sharedStay";
import {
  isMissingSharedSchema,
  listOverlappingSharedGroupsWithOccupancy,
} from "@/lib/sharedGroupsDb";

type SharedGroupOption = {
  id: string;
  listingId: string;
  startDate: string;
  endDate: string;
  totalSpots: number;
  filledSpots: number;
  activeHolds: number;
  spotsRemaining: number;
  status: "open" | "full" | "closed" | "cancelled";
  canJoin: boolean;
};

type SharedGroupOptionsResponse = {
  listingId: string;
  checkIn?: string;
  checkOut?: string;
  sharedEnabled: boolean;
  joinMode: "open" | "approval";
  weeks: number;
  minWeeks: number;
  maxWeeks: number;
  perPersonWeeklyPricePence: number | null;
  totalPricePence: number | null;
  groups: SharedGroupOption[];
  suggestedJoinGroupId: string | null;
  reason?: string;
};

const toInt = (value: unknown, fallback: number, min = 0) => {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.max(min, fallback);
  return Math.max(min, parsed);
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SharedGroupOptionsResponse | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const listingId = typeof req.query.listingId === "string" ? req.query.listingId : "";
  const checkIn = typeof req.query.checkIn === "string" ? req.query.checkIn : "";
  const checkOut = typeof req.query.checkOut === "string" ? req.query.checkOut : "";
  const hasRange = Boolean(checkIn && checkOut);

  if (!listingId) {
    return res.status(400).json({ error: "listingId is required." });
  }

  if (hasRange && (!parseIsoDateOnly(checkIn) || !parseIsoDateOnly(checkOut))) {
    return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
  }

  const weeksResult = hasRange ? getSharedStayWeeks(checkIn, checkOut) : { valid: false, weeks: 0 };
  const supabase = getSupabaseServerClient();

  const listingSelects = [
    "id, is_shared_stay, shared_total_spots, shared_weekly_price_pence, shared_join_mode, shared_min_weeks, shared_max_weeks",
    "id, is_shared_stay",
    "id",
  ];

  let listing: any = null;
  let listingError: any = null;
  for (const select of listingSelects) {
    const result = await supabase.from("listings").select(select).eq("id", listingId).maybeSingle();
    listing = result.data ?? null;
    listingError = result.error;
    if (!listingError) break;
    if (!isMissingSharedSchema(listingError)) break;
  }

  if (listingError) {
    return res.status(500).json({ error: listingError.message ?? "Unable to load listing." });
  }
  if (!listing?.id) {
    return res.status(404).json({ error: "Listing not found." });
  }

  const sharedEnabled = Boolean(listing?.is_shared_stay);
  const totalSpots = Math.max(1, toInt(listing?.shared_total_spots ?? 1, 1, 1));
  const totalWeeklyPricePence =
    listing?.shared_weekly_price_pence != null
      ? Math.max(0, toInt(listing.shared_weekly_price_pence, 0, 0))
      : 0;
  const perPersonWeeklyPricePence =
    totalWeeklyPricePence > 0
      ? computeSharedPerPersonWeeklyPricePence({
          totalWeeklyPricePence,
          totalSpots,
        }).rounded_per_person_weekly_pence
      : null;
  const minWeeks = Math.max(1, toInt(listing?.shared_min_weeks ?? 1, 1, 1));
  const maxWeeks = Math.max(minWeeks, toInt(listing?.shared_max_weeks ?? 12, 12, minWeeks));
  const joinMode = normalizeSharedJoinMode(listing?.shared_join_mode);

  if (!sharedEnabled) {
    return res.status(200).json({
      listingId,
      checkIn: hasRange ? checkIn : undefined,
      checkOut: hasRange ? checkOut : undefined,
      sharedEnabled: false,
      joinMode,
      weeks: weeksResult.weeks,
      minWeeks,
      maxWeeks,
      perPersonWeeklyPricePence,
      totalPricePence: null,
      groups: [],
      suggestedJoinGroupId: null,
      reason: "Listing is not configured for shared crew stays.",
    });
  }

  if (!hasRange) {
    let activeGroups = [];
    try {
      activeGroups = await listOverlappingSharedGroupsWithOccupancy(supabase, {
        listingId,
        statuses: ["open"],
        cleanupExpiredPending: true,
      });
    } catch (error: any) {
      if (!isMissingSharedSchema(error)) {
        return res.status(500).json({ error: error?.message ?? "Unable to load groups." });
      }
    }

    const groups: SharedGroupOption[] = activeGroups
      .filter((group) => group.status === "open" && group.active > 0)
      .map((group) => {
        const spotsRemaining = Math.max(0, group.totalSpots - group.active);
        const normalizedStatus: SharedGroupOption["status"] = spotsRemaining > 0 ? "open" : "full";
        return {
          id: group.id,
          listingId: group.listingId,
          startDate: group.startDate,
          endDate: group.endDate,
          totalSpots: group.totalSpots,
          filledSpots: group.confirmed,
          activeHolds: group.pending,
          spotsRemaining,
          status: normalizedStatus,
          canJoin: spotsRemaining > 0,
        };
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const suggestedJoinGroup = groups.find((group) => group.canJoin) ?? null;

    return res.status(200).json({
      listingId,
      sharedEnabled: true,
      joinMode,
      weeks: 0,
      minWeeks,
      maxWeeks,
      perPersonWeeklyPricePence,
      totalPricePence: null,
      groups,
      suggestedJoinGroupId: suggestedJoinGroup?.id ?? null,
    });
  }

  if (!weeksResult.valid) {
    return res.status(200).json({
      listingId,
      checkIn,
      checkOut,
      sharedEnabled: true,
      joinMode,
      weeks: weeksResult.weeks,
      minWeeks,
      maxWeeks,
      perPersonWeeklyPricePence,
      totalPricePence: null,
      groups: [],
      suggestedJoinGroupId: null,
      reason: "Shared stays are booked in full weeks.",
    });
  }

  if (weeksResult.weeks < minWeeks || weeksResult.weeks > maxWeeks) {
    return res.status(200).json({
      listingId,
      checkIn,
      checkOut,
      sharedEnabled: true,
      joinMode,
      weeks: weeksResult.weeks,
      minWeeks,
      maxWeeks,
      perPersonWeeklyPricePence,
      totalPricePence: null,
      groups: [],
      suggestedJoinGroupId: null,
      reason: `This listing supports shared stays from ${minWeeks} to ${maxWeeks} week${
        maxWeeks === 1 ? "" : "s"
      }.`,
    });
  }

  let overlappingGroups = [];
  try {
    overlappingGroups = await listOverlappingSharedGroupsWithOccupancy(supabase, {
      listingId,
      windowStart: checkIn,
      windowEnd: checkOut,
      statuses: ["open", "full", "closed"],
      cleanupExpiredPending: true,
    });
  } catch (error: any) {
    if (!isMissingSharedSchema(error)) {
      return res.status(500).json({ error: error?.message ?? "Unable to load groups." });
    }
  }

  const exactGroups = overlappingGroups.filter(
    (group) => group.startDate === checkIn && group.endDate === checkOut && group.status !== "closed"
  );
  const conflictingOccupiedGroup = overlappingGroups.find(
    (group) =>
      group.confirmed > 0 &&
      !(group.startDate === checkIn && group.endDate === checkOut)
  );

  const groups: SharedGroupOption[] = exactGroups.map((group) => {
    const spotsRemaining = Math.max(0, group.totalSpots - group.active);
    const normalizedStatus: SharedGroupOption["status"] =
      group.status === "full"
        ? "full"
        : group.status === "closed"
        ? "closed"
        : group.status === "cancelled"
        ? "cancelled"
        : "open";

    return {
      id: group.id,
      listingId: group.listingId,
      startDate: group.startDate,
      endDate: group.endDate,
      totalSpots: group.totalSpots,
      filledSpots: group.confirmed,
      activeHolds: group.pending,
      spotsRemaining,
      status: normalizedStatus,
      canJoin: normalizedStatus === "open" && spotsRemaining > 0,
    };
  });

  const suggestedJoinGroup = groups.find((group) => group.canJoin) ?? null;
  const totalPricePence =
    perPersonWeeklyPricePence != null
      ? perPersonWeeklyPricePence * weeksResult.weeks
      : null;

  return res.status(200).json({
    listingId,
    checkIn,
    checkOut,
    sharedEnabled: true,
    joinMode,
    weeks: weeksResult.weeks,
    minWeeks,
    maxWeeks,
    perPersonWeeklyPricePence,
    totalPricePence,
    groups,
    suggestedJoinGroupId: suggestedJoinGroup?.id ?? null,
    reason:
      conflictingOccupiedGroup && groups.length === 0
        ? "These dates are already reserved for another shared stay."
        : undefined,
  });
}
