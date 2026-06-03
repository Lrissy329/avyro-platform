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
