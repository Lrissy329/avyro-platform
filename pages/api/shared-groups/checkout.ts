import { SHARED_STAYS_DISABLED_BODY, SHARED_STAYS_ENABLED } from "@/lib/featureFlags";
import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { computeSharedPerPersonWeeklyPricePence, getPlatformFeeBps, PLATFORM_FEE_CAP_PENCE } from "@/lib/pricing";
import { getHostStripeReadiness } from "@/lib/hostStripeReadiness";
import {
  addMinutesIso,
  getSharedStayWeeks,
  normalizeSharedJoinMode,
  parseIsoDateOnly,
  SHARED_GROUP_PENDING_HOLD_MINUTES,
} from "@/lib/sharedStay";
import {
  checkListingSharedCapacityForRange,
  cleanupExpiredPendingSharedMembers,
  isMissingSharedSchema,
} from "@/lib/sharedGroupsDb";

type CheckoutResponse =
  | {
      checkoutUrl: string;
      sharedGroupId: string;
      sharedGroupMemberId: string;
    }
  | {
      error: string;
      code?: string;
    };

const ENABLE_SHARED_CHECKOUT_URL_DEBUG =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEBUG_SHARED_CHECKOUT === "1";

const debugLog = (payload: Record<string, unknown>) => {
  if (!ENABLE_SHARED_CHECKOUT_URL_DEBUG) return;
  console.log(`SHARED_CHECKOUT_URL_DEBUG\n${JSON.stringify(payload, null, 2)}`);
};

const resolveOrigin = (req: NextApiRequest) => {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  const forwardedProto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const forwardedHost = (req.headers["x-forwarded-host"] as string) ?? req.headers.host;
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  if (req.headers.origin) return req.headers.origin;
  return "http://localhost:3000";
};

const toInt = (value: unknown, fallback: number, min = 0) => {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.max(min, fallback);
  return Math.max(min, parsed);
};

const isGroupFullError = (error: any) => {
  const message = String(error?.message ?? "").toUpperCase();
  return message.includes("SHARED_GROUP_FULL");
};

const isMissingBookingColumnError = (error: any) => {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const combined = `${message} ${details}`;
  return (
    code === "42703" ||
    code === "PGRST204" ||
    (combined.includes("column") &&
      (combined.includes("does not exist") ||
        combined.includes("schema cache") ||
        combined.includes("could not find")))
  );
};

const extractMissingBookingColumns = (error: any): string[] => {
  const texts = [
    String(error?.message ?? ""),
    String(error?.details ?? ""),
    String(error?.hint ?? ""),
  ];
  const columns = new Set<string>();
  const patterns = [
    /could not find the ['"`]([a-z0-9_]+)['"`] column of ['"`]bookings['"`] in the schema cache/gi,
    /column\s+bookings\.([a-z0-9_]+)\s+does not exist/gi,
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

const CRITICAL_SHARED_BOOKING_COLUMNS = new Set([
  "listing_id",
  "host_id",
  "guest_id",
  "status",
  "check_in_time",
  "check_out_time",
  "currency",
  "price_total",
]);

const toUtcStartIso = (dateOnly: string) => `${dateOnly}T00:00:00.000Z`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CheckoutResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md
  if (!SHARED_STAYS_ENABLED) {
    return res.status(404).json(SHARED_STAYS_DISABLED_BODY);
  }

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace(/Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const { listingId, checkIn, checkOut, action, sharedGroupId } = req.body as {
    listingId?: string;
    checkIn?: string;
    checkOut?: string;
    action?: "join" | "start";
    sharedGroupId?: string;
  };

  if (!listingId || !checkIn || !checkOut) {
    return res.status(400).json({ error: "listingId, checkIn, and checkOut are required." });
  }

  if (!parseIsoDateOnly(checkIn) || !parseIsoDateOnly(checkOut)) {
    return res.status(400).json({ error: "Invalid dates. Use YYYY-MM-DD." });
  }

  const weeksResult = getSharedStayWeeks(checkIn, checkOut);
  if (!weeksResult.valid) {
    return res.status(400).json({
      error: "Shared stays must be booked in full weeks.",
      code: "SHARED_STAY_INVALID_WEEKS",
    });
  }

  const supabase = getSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return res.status(401).json({ error: "Invalid session" });
  }
  const userId = userData.user.id;

  const listingSelects = [
    "id, user_id, title, is_shared_stay, shared_total_spots, shared_weekly_price_pence, shared_join_mode, shared_min_weeks, shared_max_weeks",
    "id, user_id, title, is_shared_stay",
    "id, user_id, title",
  ];

  let listing: any = null;
  let listingError: any = null;
  for (const select of listingSelects) {
    const result = await supabase
      .from("listings")
      .select(select)
      .eq("id", listingId)
      .maybeSingle();
    listing = result.data ?? null;
    listingError = result.error;
    if (!listingError) break;
    if (!isMissingSharedSchema(listingError)) break;
  }

  if (listingError) {
    return res.status(500).json({ error: listingError.message ?? "Unable to load listing." });
  }
  if (!listing?.id || !listing?.user_id) {
    return res.status(404).json({ error: "Listing not found." });
  }

  if (!listing.is_shared_stay) {
    return res.status(409).json({
      error: "This listing is not set up for shared crew stays.",
      code: "SHARED_STAY_DISABLED",
    });
  }

  // Host Stripe Connect readiness gate -- must run before any shared-group
  // occupancy/member hold or booking row is created. A pending
  // shared_group_members reservation already counts toward the group's
  // occupancy (getSharedGroupOccupancy), and the provisional bookings row
  // created further below is subject to the same no_overlap EXCLUDE
  // constraint concern already fixed for the standard booking path
  // (P0-C) -- both would leave a phantom hold/row for a host who can never
  // actually be paid.
  const hostReadiness = await getHostStripeReadiness(listing.user_id);
  if (!hostReadiness.ready || !hostReadiness.stripeAccountId) {
    console.error("[api/shared-groups/checkout] host not ready for Stripe Connect charge", {
      hostId: listing.user_id,
      listingId,
      stripeAccountId: hostReadiness.stripeAccountId,
      chargesEnabled: hostReadiness.chargesEnabled,
      payoutsEnabled: hostReadiness.payoutsEnabled,
    });
    return res.status(409).json({ error: "Host is not ready to accept payments.", code: "HOST_NOT_ONBOARDED" });
  }
  const hostStripeAccountId = hostReadiness.stripeAccountId;

  const minWeeks = Math.max(1, toInt(listing.shared_min_weeks ?? 1, 1, 1));
  const maxWeeks = Math.max(minWeeks, toInt(listing.shared_max_weeks ?? 12, 12, minWeeks));
  if (weeksResult.weeks < minWeeks || weeksResult.weeks > maxWeeks) {
    return res.status(409).json({
      error: `This listing supports shared stays from ${minWeeks} to ${maxWeeks} week${
        maxWeeks === 1 ? "" : "s"
      }.`,
      code: "SHARED_STAY_WEEKS_OUT_OF_RANGE",
    });
  }

  const joinMode = normalizeSharedJoinMode(listing.shared_join_mode);
  if (joinMode === "approval") {
    return res.status(409).json({
      error: "Approval-based shared stays are not enabled yet.",
      code: "SHARED_STAY_APPROVAL_NOT_IMPLEMENTED",
    });
  }

  const totalSpots = Math.max(1, toInt(listing.shared_total_spots ?? 4, 4, 1));
  const totalWeeklyPricePence = Math.max(0, toInt(listing.shared_weekly_price_pence ?? 0, 0, 0));
  const perPersonWeeklyPricePence =
    totalWeeklyPricePence > 0
      ? computeSharedPerPersonWeeklyPricePence({
          totalWeeklyPricePence,
          totalSpots,
        }).rounded_per_person_weekly_pence
      : 0;
  if (perPersonWeeklyPricePence <= 0) {
    return res.status(409).json({
      error: "Shared weekly price is not configured for this listing.",
      code: "SHARED_STAY_PRICE_MISSING",
    });
  }

  const checkoutAction: "join" | "start" = action === "start" ? "start" : "join";
  let targetGroup: any = null;

  // Resolve (but do not yet create) the target group. "join" requires an
  // existing group -- 404 if none matches, unchanged. "start" looks up an
  // exact-date match only; if none exists, creation is deferred until
  // after the single authoritative capacity check below, so a brand-new
  // (empty) group is never created when capacity is already unavailable.
  if (checkoutAction === "join") {
    if (sharedGroupId) {
      const groupResult = await supabase
        .from("shared_groups")
        .select("id, listing_id, start_date, end_date, total_spots, status")
        .eq("id", sharedGroupId)
        .eq("listing_id", listingId)
        .eq("start_date", checkIn)
        .eq("end_date", checkOut)
        .in("status", ["open", "full"])
        .maybeSingle();

      if (groupResult.error && !isMissingSharedSchema(groupResult.error)) {
        return res.status(500).json({ error: groupResult.error.message ?? "Failed to load shared group." });
      }
      targetGroup = groupResult.data ?? null;
    } else {
      const groupResult = await supabase
        .from("shared_groups")
        .select("id, listing_id, start_date, end_date, total_spots, status, created_at")
        .eq("listing_id", listingId)
        .eq("start_date", checkIn)
        .eq("end_date", checkOut)
        .in("status", ["open", "full"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (groupResult.error && !isMissingSharedSchema(groupResult.error)) {
        return res.status(500).json({ error: groupResult.error.message ?? "Failed to load shared group." });
      }
      targetGroup = groupResult.data ?? null;
    }

    if (!targetGroup?.id) {
      return res.status(409).json({
        error: "No open shared group was found for these dates.",
        code: "SHARED_GROUP_NOT_FOUND",
      });
    }
  } else {
    const existingGroupResult = await supabase
      .from("shared_groups")
      .select("id, listing_id, start_date, end_date, total_spots, status")
      .eq("listing_id", listingId)
      .eq("start_date", checkIn)
      .eq("end_date", checkOut)
      .in("status", ["open", "full", "closed"])
      .maybeSingle();

    if (existingGroupResult.error && !isMissingSharedSchema(existingGroupResult.error)) {
      return res
        .status(500)
        .json({ error: existingGroupResult.error.message ?? "Failed to load existing groups." });
    }
    targetGroup = existingGroupResult.data ?? null;
  }

  // existingMembership can only be non-null if targetGroup already exists
  // -- a brand-new group ("start" with no exact-date match, targetGroup
  // still null here) cannot have a prior membership to look up.
  let existingMembership: { id: string; status: string; reservation_expires_at: string | null } | null = null;
  if (targetGroup?.id) {
    try {
      await cleanupExpiredPendingSharedMembers(supabase, [String(targetGroup.id)]);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to refresh pending members." });
    }

    const existingMembershipResult = await supabase
      .from("shared_group_members")
      .select("id, status, reservation_expires_at")
      .eq("shared_group_id", targetGroup.id)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (existingMembershipResult.error && !isMissingSharedSchema(existingMembershipResult.error)) {
      return res.status(500).json({
        error: existingMembershipResult.error.message ?? "Failed to verify existing membership.",
      });
    }
    existingMembership = existingMembershipResult.data ?? null;
  }

  if (existingMembership?.status === "confirmed") {
    return res.status(409).json({
      error: "You already joined this shared stay.",
      code: "SHARED_GROUP_ALREADY_JOINED",
    });
  }

  // additionalOccupants reflects the product rule exactly: an existing
  // membership counts as 0 additional occupants only if it is ALREADY
  // active occupancy (confirmed, or pending with a hold that has not
  // expired) -- not merely "a row exists". Cancelled, expired-pending, and
  // "no membership at all" all mean this request would add a genuinely new
  // physical occupant. Mirrors getSharedGroupOccupancy's own effective-
  // active test (lib/sharedGroupsDb.ts) -- expiry is read directly from
  // reservation_expires_at, never inferred from status alone.
  const nowMs = Date.now();
  const existingMembershipAlreadyActive = Boolean(
    existingMembership &&
      (existingMembership.status === "confirmed" ||
        (existingMembership.status === "pending" &&
          (!existingMembership.reservation_expires_at ||
            new Date(existingMembership.reservation_expires_at).getTime() > nowMs)))
  );

  // Single authoritative aggregate-capacity decision, shared by both the
  // start and join flows -- made now, with full context (whether the
  // guest already occupies a spot), and before a brand-new group would
  // ever be created, so capacity exhaustion never leaves an empty group
  // behind. Each shared_groups row's own total_spots is set to the full
  // listing capacity (see totalSpots above), so a per-group-only check
  // would allow two different overlapping groups to each fill to the
  // listing's full capacity independently, jointly overselling a shared
  // night. This is still an app-level, advisory check (race-window caveat
  // documented in the Stage 2 migration design); the DB trigger extension
  // in Stage 2 is what makes this actually race-safe.
  const listingCapacityCheck = await checkListingSharedCapacityForRange(supabase, {
    listingId,
    startDate: checkIn,
    endDate: checkOut,
    listingTotalSpots: totalSpots,
    additionalOccupants: existingMembershipAlreadyActive ? 0 : 1,
  });
  if (!listingCapacityCheck.ok) {
    return res.status(409).json(
      targetGroup?.id
        ? { error: "This shared group is now full.", code: "SHARED_GROUP_FULL" }
        : {
            error: "These dates are already reserved for another shared stay.",
            code: "SHARED_GROUP_RANGE_RESERVED",
          }
    );
  }

  if (!targetGroup?.id) {
    // "start", no exact-date group existed, and capacity is now confirmed
    // available -- create it, not before the capacity check above.
    const createGroupResult = await supabase
      .from("shared_groups")
      .insert({
        listing_id: listingId,
        start_date: checkIn,
        end_date: checkOut,
        total_spots: totalSpots,
        filled_spots: 0,
        status: "open",
        created_by_user_id: userId,
      })
      .select("id, listing_id, start_date, end_date, total_spots, status")
      .single();

    if (createGroupResult.error) {
      if (String(createGroupResult.error.code ?? "") === "23505") {
        // Lost a create race to another concurrent "start" request for the
        // exact same dates -- adopt the group it created. This is the same
        // pre-existing race-retry path the original code had; the
        // capacity/membership decision above was made before this other
        // group's existence was known, so the Stage 2 DB trigger (not yet
        // applied) is what makes this specific sub-case fully race-safe.
        const retryExisting = await supabase
          .from("shared_groups")
          .select("id, listing_id, start_date, end_date, total_spots, status")
          .eq("listing_id", listingId)
          .eq("start_date", checkIn)
          .eq("end_date", checkOut)
          .in("status", ["open", "full", "closed"])
          .maybeSingle();
        if (!retryExisting.error && retryExisting.data?.id) {
          targetGroup = retryExisting.data;
        } else {
          return res.status(409).json({
            error: "A shared group for these dates was created by another guest. Please try again.",
            code: "SHARED_GROUP_RACE_RETRY",
          });
        }
      } else {
        if (isMissingSharedSchema(createGroupResult.error)) {
          return res.status(500).json({
            error: "Shared stay tables are not available yet. Run the latest migration first.",
          });
        }
        return res
          .status(500)
          .json({ error: createGroupResult.error.message ?? "Failed to create shared group." });
      }
    } else {
      targetGroup = createGroupResult.data;
    }
  }

  const targetGroupId = String(targetGroup.id);

  const reservationExpiresAt = addMinutesIso(SHARED_GROUP_PENDING_HOLD_MINUTES);
  const memberPayload = {
    status: "pending",
    amount_paid_pence: 0,
    reservation_expires_at: reservationExpiresAt,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    joined_at: null,
    updated_at: new Date().toISOString(),
  };

  let sharedGroupMemberId: string;
  if (existingMembership?.id) {
    const memberReuse = await supabase
      .from("shared_group_members")
      .update(memberPayload)
      .eq("id", existingMembership.id)
      .select("id")
      .single();

    if (memberReuse.error) {
      if (isGroupFullError(memberReuse.error)) {
        return res.status(409).json({
          error: "This shared group is now full.",
          code: "SHARED_GROUP_FULL",
        });
      }
      if (isMissingSharedSchema(memberReuse.error)) {
        return res.status(500).json({
          error: "Shared stay tables are not available yet. Run the latest migration first.",
        });
      }
      return res.status(500).json({
        error: memberReuse.error.message ?? "Unable to reserve a spot in this shared group.",
      });
    }

    sharedGroupMemberId = String(memberReuse.data.id);
  } else {
    const memberInsert = await supabase
      .from("shared_group_members")
      .insert({
        shared_group_id: targetGroupId,
        user_id: userId,
        ...memberPayload,
      })
      .select("id")
      .single();

    if (memberInsert.error) {
      if (isGroupFullError(memberInsert.error)) {
        return res.status(409).json({
          error: "This shared group is now full.",
          code: "SHARED_GROUP_FULL",
        });
      }
      if (isMissingSharedSchema(memberInsert.error)) {
        return res.status(500).json({
          error: "Shared stay tables are not available yet. Run the latest migration first.",
        });
      }
      return res.status(500).json({
        error: memberInsert.error.message ?? "Unable to reserve a spot in this shared group.",
      });
    }

    sharedGroupMemberId = String(memberInsert.data.id);
  }
  const amountPence = perPersonWeeklyPricePence * weeksResult.weeks;

  // Host net derivation -- shared_weekly_price_pence (and therefore
  // amountPence, the member's guest charge) is treated as already
  // all-inclusive per product decision; amountPence itself is never
  // changed here. The platform fee is computed from amountPence using the
  // same nights-tiered bps table and cap the standard booking path
  // centralizes in lib/pricing.ts -- getPlatformFeeBps() for the
  // percentage, PLATFORM_FEE_CAP_PENCE for the cap -- combined with the
  // same floor/cap arithmetic lib/pricing.ts's computeFeeEstimates() uses
  // internally, mirrored here rather than imported since that function
  // isn't exported and also folds in Stripe-fee/margin reasoning this
  // per-member derivation doesn't need.
  const sharedNightsForFeeTier = weeksResult.weeks * 7;
  const sharedPlatformFeeBps = getPlatformFeeBps({
    nights: sharedNightsForFeeTier,
    isFirstCompletedBooking: false,
  });
  const applicationFeeAmount = Math.min(
    Math.floor((amountPence * sharedPlatformFeeBps) / 10000),
    PLATFORM_FEE_CAP_PENCE
  );
  const hostNetTotalPence = amountPence - applicationFeeAmount;

  if (
    !Number.isInteger(applicationFeeAmount) ||
    applicationFeeAmount < 0 ||
    applicationFeeAmount > amountPence
  ) {
    console.error("[api/shared-groups/checkout] computed application_fee_amount is invalid", {
      amountPence,
      sharedPlatformFeeBps,
      applicationFeeAmount,
      sharedGroupMemberId,
    });
    return res.status(500).json({
      error: "Invalid application fee amount computed for this shared-stay charge.",
    });
  }

  const provisionalBookingPayload = {
    listing_id: String(listingId),
    host_id: String(listing.user_id),
    guest_id: String(userId),
    status: "awaiting_payment",
    payout_status: "pending",
    stay_type: "nightly",
    channel: "direct",
    check_in_time: toUtcStartIso(checkIn),
    check_out_time: toUtcStartIso(checkOut),
    nights: weeksResult.weeks * 7,
    guests_total: 1,
    currency: "GBP",
    price_total: amountPence / 100,
    guest_total_pence: amountPence,
    host_net_total_pence: hostNetTotalPence,
    platform_fee_bps: sharedPlatformFeeBps,
    guest_unit_price_pence: weeksResult.weeks > 0 ? Math.round(amountPence / (weeksResult.weeks * 7)) : amountPence,
    booking_type: "shared_group",
    shared_group_id: targetGroupId,
    stripe_status: "pending",
  };
  let provisionalBookingId: string | null = null;
  let provisionalPayload: Record<string, any> = { ...provisionalBookingPayload };
  let provisionalAttempts = 0;
  const maxProvisionalAttempts = 20;
  while (provisionalAttempts < maxProvisionalAttempts) {
    const provisionalInsert = await supabase
      .from("bookings")
      .insert(provisionalPayload)
      .select("id")
      .single();
    if (!provisionalInsert.error && provisionalInsert.data?.id) {
      provisionalBookingId = String(provisionalInsert.data.id);
      break;
    }
    if (
      !provisionalInsert.error ||
      (!isMissingSharedSchema(provisionalInsert.error) &&
        !isMissingBookingColumnError(provisionalInsert.error))
    ) {
      break;
    }
    const missingColumns = extractMissingBookingColumns(provisionalInsert.error).filter((column) =>
      Object.prototype.hasOwnProperty.call(provisionalPayload, column)
    );
    if (missingColumns.length === 0) {
      break;
    }
    const missingCriticalColumns = missingColumns.filter((column) =>
      CRITICAL_SHARED_BOOKING_COLUMNS.has(column)
    );
    if (missingCriticalColumns.length > 0) {
      break;
    }
    missingColumns.forEach((column) => {
      delete provisionalPayload[column];
    });
    provisionalAttempts += 1;
  }
  const origin = resolveOrigin(req);
  const successUrl = provisionalBookingId
    ? `${origin}/booking/success?booking=${provisionalBookingId}&session_id={CHECKOUT_SESSION_ID}`
    : `${origin}/booking/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/listing/${listingId}?payment=cancelled`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      currency: "gbp",
      customer_creation: "always",
      payment_method_types: ["card"],
      payment_intent_data: {
        setup_future_usage: "off_session",
        application_fee_amount: applicationFeeAmount,
        transfer_data: {
          destination: hostStripeAccountId,
        },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: amountPence,
            product_data: {
              name: listing.title
                ? `Shared stay at ${listing.title}`
                : "Shared stay",
              description: `${weeksResult.weeks} week${weeksResult.weeks === 1 ? "" : "s"} · 1 spot`,
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Matches the 30-minute shared_group_members reservation hold set
      // above (SHARED_GROUP_PENDING_HOLD_MINUTES) so the payment window
      // and the capacity hold always expire together -- see
      // pages/api/stripe-webhook.ts's checkout.session.expired handler.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: {
        checkout_kind: "shared_group_member",
        shared_group_id: targetGroupId,
        shared_group_member_id: sharedGroupMemberId,
        listing_id: String(listingId),
        host_id: String(listing.user_id),
        guest_id: String(userId),
        booking_id: provisionalBookingId ?? "",
        booking_type: "shared_group",
        check_in: checkIn,
        check_out: checkOut,
        weeks: String(weeksResult.weeks),
        per_person_weekly_price_pence: String(perPersonWeeklyPricePence),
        total_property_weekly_price_pence: String(totalWeeklyPricePence),
        amount_pence: String(amountPence),
        action: checkoutAction,
      },
    },
    {
      idempotencyKey: `shared-checkout-${sharedGroupMemberId}`,
    }
  );
  debugLog({
    base_url: origin,
    success_url: successUrl,
    cancel_url: cancelUrl,
    session_id: session?.id ?? null,
    metadata_keys: Object.keys(session?.metadata ?? {}),
    booking_id: provisionalBookingId,
  });

  if (!session?.url || !session.id) {
    if (provisionalBookingId) {
      await supabase
        .from("bookings")
        .update({ status: "cancelled", stripe_status: "cancelled" })
        .eq("id", provisionalBookingId);
    }
    await supabase
      .from("shared_group_members")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", sharedGroupMemberId);
    return res.status(500).json({ error: "Unable to start checkout session." });
  }

  const updateMember = await supabase
    .from("shared_group_members")
    .update({
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sharedGroupMemberId);

  if (updateMember.error && !isMissingSharedSchema(updateMember.error)) {
    return res.status(500).json({
      error: updateMember.error.message ?? "Unable to store checkout session.",
    });
  }

  if (provisionalBookingId) {
    const bookingSessionUpdate = await supabase
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
      })
      .eq("id", provisionalBookingId);
    if (bookingSessionUpdate.error && !isMissingSharedSchema(bookingSessionUpdate.error)) {
      debugLog({
        stage: "provisional_booking_session_update_failed",
        booking_id: provisionalBookingId,
        session_id: session.id,
        error: bookingSessionUpdate.error,
      });
    }
  }

  return res.status(200).json({
    checkoutUrl: session.url,
    sharedGroupId: targetGroupId,
    sharedGroupMemberId,
  });
}
