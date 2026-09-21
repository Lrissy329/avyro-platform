type SupabaseLike = any;

export const isMissingSharedSchema = (error: any) => {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42p01" ||
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("relation") ||
    (message.includes("column") && message.includes("does not exist")) ||
    message.includes("shared_group")
  );
};

export async function cleanupExpiredPendingSharedMembers(
  supabase: SupabaseLike,
  groupIds: string[]
) {
  if (!groupIds.length) return;
  const { error } = await supabase
    .from("shared_group_members")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .in("shared_group_id", groupIds)
    .eq("status", "pending")
    .lt("reservation_expires_at", new Date().toISOString());

  if (error && !isMissingSharedSchema(error)) {
    throw error;
  }
}

export async function getSharedGroupOccupancy(
  supabase: SupabaseLike,
  groupIds: string[]
) {
  const empty: Record<string, { active: number; confirmed: number; pending: number }> = {};
  groupIds.forEach((id) => {
    empty[id] = { active: 0, confirmed: 0, pending: 0 };
  });
  if (!groupIds.length) return empty;

  const { data, error } = await supabase
    .from("shared_group_members")
    .select("shared_group_id, status, reservation_expires_at")
    .in("shared_group_id", groupIds)
    .in("status", ["pending", "confirmed"]);

  if (error && !isMissingSharedSchema(error)) {
    throw error;
  }

  const nowMs = Date.now();
  (data ?? []).forEach((row: any) => {
    const groupId = String(row?.shared_group_id ?? "");
    if (!groupId || !empty[groupId]) return;

    const status = String(row?.status ?? "").toLowerCase();
    if (status === "confirmed") {
      empty[groupId].confirmed += 1;
      empty[groupId].active += 1;
      return;
    }

    if (status === "pending") {
      const expiresAtRaw = row?.reservation_expires_at;
      const expiresAtMs = expiresAtRaw ? new Date(String(expiresAtRaw)).getTime() : Number.POSITIVE_INFINITY;
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) return;
      empty[groupId].pending += 1;
      empty[groupId].active += 1;
    }
  });

  return empty;
}

export type SharedGroupWithOccupancy = {
  id: string;
  listingId: string;
  startDate: string;
  endDate: string;
  totalSpots: number;
  status: string;
  confirmed: number;
  pending: number;
  active: number;
};

export async function listOverlappingSharedGroupsWithOccupancy(
  supabase: SupabaseLike,
  params: {
    listingId: string;
    windowStart?: string;
    windowEnd?: string;
    statuses?: string[];
    cleanupExpiredPending?: boolean;
  }
) {
  const {
    listingId,
    windowStart,
    windowEnd,
    statuses = ["open", "full", "closed"],
    cleanupExpiredPending = false,
  } = params;

  let query = supabase
    .from("shared_groups")
    .select("id, listing_id, start_date, end_date, total_spots, status")
    .eq("listing_id", listingId)
    .in("status", statuses)
    .order("start_date", { ascending: true })
    .limit(500);

  if (windowStart && windowEnd) {
    query = query.lt("start_date", windowEnd).gt("end_date", windowStart);
  }

  const { data: groupRows, error: groupError } = await query;

  if (groupError && !isMissingSharedSchema(groupError)) {
    throw groupError;
  }

  const groups = groupRows ?? [];
  const groupIds = groups.map((group: any) => String(group.id)).filter(Boolean);
  if (cleanupExpiredPending && groupIds.length > 0) {
    await cleanupExpiredPendingSharedMembers(supabase, groupIds);
  }

  const occupancyByGroup = await getSharedGroupOccupancy(supabase, groupIds);
  return groups.map((group: any) => {
    const groupId = String(group.id);
    const occupancy = occupancyByGroup[groupId] ?? { active: 0, confirmed: 0, pending: 0 };
    return {
      id: groupId,
      listingId: String(group.listing_id),
      startDate: String(group.start_date).slice(0, 10),
      endDate: String(group.end_date).slice(0, 10),
      totalSpots: Math.max(1, Math.round(Number(group.total_spots ?? 1)) || 1),
      status: String(group.status ?? "").toLowerCase(),
      confirmed: occupancy.confirmed,
      pending: occupancy.pending,
      active: occupancy.active,
    } satisfies SharedGroupWithOccupancy;
  });
}

const addDaysToIsoDate = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
};

export type SharedListingCapacityCheck = {
  ok: boolean;
  listingTotalSpots: number;
  worstNightOccupancy: number;
  worstNightDate: string | null;
};

// Aggregate physical-capacity check across ALL overlapping shared_groups for
// a listing, not just one group. shared_total_spots is the listing's real
// capacity -- two different groups with overlapping date ranges must never
// jointly exceed it on any shared night, even though each group's own
// total_spots is independently set to the full listing capacity (see
// pages/api/shared-groups/checkout.ts).
//
// "closed" groups are deliberately included in the occupancy sum (per
// product decision): closed means "not joinable", not "guests vacated" --
// their confirmed/pending members still physically occupy spots and must
// still count. Callers that only want *joinable* groups (guest-facing
// discovery) filter status separately; this function only computes whether
// there is room, not who can join.
//
// This is an advisory/UX-layer check only -- it is not a substitute for
// DB-level enforcement under concurrency (see Stage 2 migration design).
export async function checkListingSharedCapacityForRange(
  supabase: SupabaseLike,
  params: {
    listingId: string;
    startDate: string; // inclusive, YYYY-MM-DD
    endDate: string; // exclusive, YYYY-MM-DD
    listingTotalSpots: number;
    additionalOccupants?: number;
  }
): Promise<SharedListingCapacityCheck> {
  const { listingId, startDate, endDate, listingTotalSpots, additionalOccupants = 1 } = params;

  const overlappingGroups = await listOverlappingSharedGroupsWithOccupancy(supabase, {
    listingId,
    windowStart: startDate,
    windowEnd: endDate,
    statuses: ["open", "full", "closed"],
    cleanupExpiredPending: true,
  });

  let worstNightOccupancy = 0;
  let worstNightDate: string | null = null;

  let night = startDate;
  while (night < endDate) {
    const nightOccupancy = overlappingGroups.reduce((sum, group) => {
      if (group.startDate <= night && night < group.endDate) {
        return sum + group.active;
      }
      return sum;
    }, 0);
    if (nightOccupancy > worstNightOccupancy) {
      worstNightOccupancy = nightOccupancy;
      worstNightDate = night;
    }
    night = addDaysToIsoDate(night, 1);
  }

  return {
    ok: worstNightOccupancy + additionalOccupants <= listingTotalSpots,
    listingTotalSpots,
    worstNightOccupancy,
    worstNightDate,
  };
}
