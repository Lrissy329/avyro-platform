import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";
import {
  addMinutesIso,
  getSharedStayWeeks,
  normalizeSharedJoinMode,
  parseIsoDateOnly,
  SHARED_GROUP_PENDING_HOLD_MINUTES,
} from "@/lib/sharedStay";
import {
  cleanupExpiredPendingSharedMembers,
  getSharedGroupOccupancy,
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CheckoutResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
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
    if (existingGroupResult.data?.id) {
      targetGroup = existingGroupResult.data;
    } else {
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
  }

  const targetGroupId = String(targetGroup.id);
  try {
    await cleanupExpiredPendingSharedMembers(supabase, [targetGroupId]);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? "Failed to refresh pending members." });
  }

  const existingMembershipResult = await supabase
    .from("shared_group_members")
    .select("id, status, reservation_expires_at")
    .eq("shared_group_id", targetGroupId)
    .eq("user_id", userId)
    .in("status", ["pending", "confirmed"])
    .limit(1)
    .maybeSingle();

  if (existingMembershipResult.error && !isMissingSharedSchema(existingMembershipResult.error)) {
    return res.status(500).json({
      error: existingMembershipResult.error.message ?? "Failed to verify existing membership.",
    });
  }

  const existingMembership = existingMembershipResult.data;
  if (existingMembership?.status === "confirmed") {
    return res.status(409).json({
      error: "You already joined this shared stay.",
      code: "SHARED_GROUP_ALREADY_JOINED",
    });
  }

  if (existingMembership?.status === "pending") {
    await supabase
      .from("shared_group_members")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", existingMembership.id);
  }

  const occupancyByGroup = await getSharedGroupOccupancy(supabase, [targetGroupId]);
  const occupancy = occupancyByGroup[targetGroupId] ?? { active: 0, confirmed: 0, pending: 0 };
  const groupTotalSpots = Math.max(1, toInt(targetGroup.total_spots ?? totalSpots, totalSpots, 1));
  if (occupancy.active >= groupTotalSpots) {
    return res.status(409).json({
      error: "This shared group is now full.",
      code: "SHARED_GROUP_FULL",
    });
  }

  const reservationExpiresAt = addMinutesIso(SHARED_GROUP_PENDING_HOLD_MINUTES);
  const memberInsert = await supabase
    .from("shared_group_members")
    .insert({
      shared_group_id: targetGroupId,
      user_id: userId,
      status: "pending",
      amount_paid_pence: 0,
      reservation_expires_at: reservationExpiresAt,
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

  const sharedGroupMemberId = String(memberInsert.data.id);
  const amountPence = perPersonWeeklyPricePence * weeksResult.weeks;
  const origin = resolveOrigin(req);
  const successUrl = `${origin}/booking/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/listing/${listingId}?payment=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    currency: "gbp",
    customer_creation: "always",
    payment_method_types: ["card"],
    payment_intent_data: {
      setup_future_usage: "off_session",
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
    metadata: {
      checkout_kind: "shared_group_member",
      shared_group_id: targetGroupId,
      shared_group_member_id: sharedGroupMemberId,
      listing_id: String(listingId),
      host_id: String(listing.user_id),
      guest_id: String(userId),
      booking_type: "shared_group",
      check_in: checkIn,
      check_out: checkOut,
      weeks: String(weeksResult.weeks),
      per_person_weekly_price_pence: String(perPersonWeeklyPricePence),
      total_property_weekly_price_pence: String(totalWeeklyPricePence),
      amount_pence: String(amountPence),
      action: checkoutAction,
    },
  });

  if (!session?.url || !session.id) {
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

  return res.status(200).json({
    checkoutUrl: session.url,
    sharedGroupId: targetGroupId,
    sharedGroupMemberId,
  });
}
