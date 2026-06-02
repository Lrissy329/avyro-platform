import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";
import { getSharedStayWeeks, normalizeSharedJoinMode, parseIsoDateOnly } from "@/lib/sharedStay";
import {
  cleanupExpiredPendingSharedMembers,
  getSharedGroupOccupancy,
  isMissingSharedSchema,
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
  checkIn: string;
  checkOut: string;
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

  if (!listingId || !checkIn || !checkOut) {
    return res.status(400).json({ error: "listingId, checkIn, and checkOut are required." });
  }

  if (!parseIsoDateOnly(checkIn) || !parseIsoDateOnly(checkOut)) {
    return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
  }

  const weeksResult = getSharedStayWeeks(checkIn, checkOut);
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
      checkIn,
      checkOut,
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

  const groupResult = await supabase
    .from("shared_groups")
    .select("id, listing_id, start_date, end_date, total_spots, filled_spots, status, created_at")
    .eq("listing_id", listingId)
    .eq("start_date", checkIn)
    .eq("end_date", checkOut)
    .in("status", ["open", "full"])
    .order("created_at", { ascending: true })
    .limit(20);

  if (groupResult.error) {
    if (!isMissingSharedSchema(groupResult.error)) {
      return res.status(500).json({ error: groupResult.error.message ?? "Unable to load groups." });
    }
  }

  const groupRows = groupResult.data ?? [];
  const groupIds = groupRows.map((row: any) => String(row.id)).filter(Boolean);

  try {
    await cleanupExpiredPendingSharedMembers(supabase, groupIds);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? "Failed to refresh pending members." });
  }

  const occupancyByGroup = await getSharedGroupOccupancy(supabase, groupIds);
  const groups: SharedGroupOption[] = groupRows.map((row: any) => {
    const groupId = String(row.id);
    const occupancy = occupancyByGroup[groupId] ?? { active: 0, confirmed: 0, pending: 0 };
    const totalSpots = Math.max(1, toInt(row.total_spots, 1, 1));
    const spotsRemaining = Math.max(0, totalSpots - occupancy.active);
    const normalizedStatus: SharedGroupOption["status"] =
      row.status === "full"
        ? "full"
        : row.status === "closed"
        ? "closed"
        : row.status === "cancelled"
        ? "cancelled"
        : "open";

    return {
      id: groupId,
      listingId: String(row.listing_id),
      startDate: String(row.start_date).slice(0, 10),
      endDate: String(row.end_date).slice(0, 10),
      totalSpots,
      filledSpots: occupancy.confirmed,
      activeHolds: occupancy.pending,
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
  });
}
