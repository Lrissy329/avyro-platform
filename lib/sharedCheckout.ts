import { differenceInCalendarDays } from "date-fns";
import { parseIsoDateOnly } from "@/lib/sharedStay";
import { getSharedGroupOccupancy, isMissingSharedSchema } from "@/lib/sharedGroupsDb";

type SupabaseLike = any;
type StripeCheckoutSessionLike = {
  id: string;
  metadata?: Record<string, string | null | undefined>;
  payment_intent?: string | { id?: string | null } | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string | null;
};

const toUtcStartIso = (dateOnly: string) => `${dateOnly}T00:00:00.000Z`;
const ENABLE_SHARED_CHECKOUT_DEBUG =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEBUG_SHARED_CHECKOUT === "1";

const debugLog = (payload: Record<string, unknown>) => {
  if (!ENABLE_SHARED_CHECKOUT_DEBUG) return;
  console.log(`SHARED_CHECKOUT_CONFIRM_DEBUG\n${JSON.stringify(payload, null, 2)}`);
  console.log(`SHARED_CONFIRMATION_STATE_DEBUG\n${JSON.stringify(payload, null, 2)}`);
  console.log(`SHARED_CHECKOUT_RELIABILITY_DEBUG\n${JSON.stringify(payload, null, 2)}`);
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

const isPaidStripeStatus = (status?: string | null) =>
  ["paid", "succeeded", "complete"].includes(String(status ?? "").toLowerCase());

const isFinalizedBookingStatus = (status?: string | null) =>
  ["confirmed", "paid", "completed"].includes(String(status ?? "").toLowerCase());

const resolvePaidBookingStatus = (status?: string | null, stripeStatus?: string | null) => {
  const normalizedStatus = String(status ?? "").toLowerCase();
  if (
    isPaidStripeStatus(stripeStatus) &&
    ["awaiting_payment", "approved", "pending", "payment_failed", "paid", "confirmed"].includes(
      normalizedStatus
    )
  ) {
    return "paid";
  }
  return normalizedStatus || "paid";
};

const reconcileSharedGroupOccupancy = async (
  supabaseAdmin: SupabaseLike,
  sharedGroupId: string
) => {
  const occupancyByGroup = await getSharedGroupOccupancy(supabaseAdmin, [sharedGroupId]);
  const occupancy = occupancyByGroup[sharedGroupId] ?? { active: 0, confirmed: 0, pending: 0 };
  const { data: groupRow } = await supabaseAdmin
    .from("shared_groups")
    .select("id, total_spots")
    .eq("id", sharedGroupId)
    .maybeSingle();
  const totalSpots = Math.max(1, Math.round(Number(groupRow?.total_spots ?? 1)) || 1);
  const groupStatus = occupancy.active >= totalSpots ? "full" : "open";
  await supabaseAdmin
    .from("shared_groups")
    .update({
      filled_spots: occupancy.confirmed,
      status: groupStatus,
    })
    .eq("id", sharedGroupId);

  return {
    occupancy,
    totalSpots,
    groupStatus,
  };
};

export const isSharedGroupCheckoutSession = (session: StripeCheckoutSessionLike | null | undefined) =>
  String(session?.metadata?.checkout_kind ?? "").toLowerCase() === "shared_group_member";

export async function finalizeSharedGroupCheckout(params: {
  supabaseAdmin: SupabaseLike;
  session: StripeCheckoutSessionLike;
}) {
  const { supabaseAdmin, session } = params;
  if (!isSharedGroupCheckoutSession(session)) {
    return { handled: false as const, bookingId: null as string | null };
  }

  const metadata = session.metadata ?? {};
  const sharedGroupId = String(metadata.shared_group_id ?? "");
  const sharedGroupMemberId = String(metadata.shared_group_member_id ?? "");
  const metadataBookingId = String(metadata.booking_id ?? metadata.bookingId ?? "");
  const listingId = String(metadata.listing_id ?? "");
  const hostId = String(metadata.host_id ?? "");
  const guestId = String(metadata.guest_id ?? "");
  const checkIn = String(metadata.check_in ?? "");
  const checkOut = String(metadata.check_out ?? "");
  if (
    !sharedGroupId ||
    !sharedGroupMemberId ||
    !listingId ||
    !hostId ||
    !guestId ||
    !checkIn ||
    !checkOut
  ) {
    return {
      handled: true as const,
      bookingId: null as string | null,
      error: "Shared checkout metadata is incomplete.",
      code: "SHARED_CHECKOUT_METADATA_MISSING",
    };
  }

  const checkInDate = parseIsoDateOnly(checkIn);
  const checkOutDate = parseIsoDateOnly(checkOut);
  if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
    return {
      handled: true as const,
      bookingId: null as string | null,
      error: "Shared checkout dates are invalid.",
      code: "SHARED_CHECKOUT_DATES_INVALID",
    };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent && typeof session.payment_intent === "object"
      ? session.payment_intent.id ?? null
      : null;
  const amountPence = Number.isFinite(Number(session.amount_total))
    ? Math.max(0, Math.round(Number(session.amount_total)))
    : 0;
  const currency = String(session.currency ?? "GBP").toUpperCase();
  const nights = Math.max(1, differenceInCalendarDays(checkOutDate, checkInDate));
  const guestUnitPricePence = nights > 0 ? Math.round(amountPence / nights) : amountPence;

  const currentMemberResult = await supabaseAdmin
    .from("shared_group_members")
    .select(
      "id, status, amount_paid_pence, stripe_checkout_session_id, stripe_payment_intent_id, shared_group_id"
    )
    .eq("id", sharedGroupMemberId)
    .eq("shared_group_id", sharedGroupId)
    .maybeSingle();

  if (currentMemberResult.error) {
    return {
      handled: true as const,
      bookingId: null as string | null,
      error: currentMemberResult.error.message ?? "Failed to load shared-group member state.",
      code: "SHARED_MEMBER_LOOKUP_FAILED",
    };
  }

  debugLog({
    stage: "start",
    session_id: session.id,
    metadata,
    shared_group_id: sharedGroupId,
    shared_group_member_id: sharedGroupMemberId,
    listing_id: listingId,
    guest_id: guestId,
    host_id: hostId,
    check_in: checkIn,
    check_out: checkOut,
    amount_pence: amountPence,
    currency,
    member_status_before: currentMemberResult.data?.status ?? null,
  });

  const existingBookingResult = metadataBookingId
    ? await supabaseAdmin
        .from("bookings")
        .select("id, status, stripe_status, stripe_checkout_session_id, payout_status")
        .eq("id", metadataBookingId)
        .maybeSingle()
    : await supabaseAdmin
        .from("bookings")
        .select("id, status, stripe_status, stripe_checkout_session_id, payout_status")
        .or(
          `stripe_checkout_session_id.eq.${session.id},and(booking_type.eq.shared_group,shared_group_id.eq.${sharedGroupId},guest_id.eq.${guestId})`
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (existingBookingResult.error && !isMissingSharedSchema(existingBookingResult.error)) {
    debugLog({
      stage: "existing_booking_lookup_failed",
      session_id: session.id,
      error: existingBookingResult.error,
    });
    return {
      handled: true as const,
      bookingId: null as string | null,
      error: existingBookingResult.error.message ?? "Failed to check existing shared booking.",
      code: "SHARED_BOOKING_LOOKUP_FAILED",
    };
  }

  let bookingId: string | null = existingBookingResult.data?.id ?? null;
  const existingBooking = existingBookingResult.data ?? null;

  const alreadyFinalized =
    String(currentMemberResult.data?.status ?? "").toLowerCase() === "confirmed" &&
    existingBooking?.id &&
    isFinalizedBookingStatus(existingBooking.status) &&
    isPaidStripeStatus(existingBooking.stripe_status);

  if (alreadyFinalized) {
    try {
      const reconciled = await reconcileSharedGroupOccupancy(supabaseAdmin, sharedGroupId);
      debugLog({
        stage: "already_finalized_skip",
        session_id: session.id,
        booking_id: existingBooking.id,
        shared_group_id: sharedGroupId,
        shared_group_member_id: sharedGroupMemberId,
        member_status: currentMemberResult.data?.status ?? null,
        booking_status: existingBooking.status ?? null,
        stripe_status: existingBooking.stripe_status ?? null,
        occupancy_result: reconciled,
      });
    } catch (error) {
      debugLog({
        stage: "already_finalized_skip_reconcile_failed",
        session_id: session.id,
        booking_id: existingBooking.id,
        shared_group_id: sharedGroupId,
        error,
      });
    }
    return {
      handled: true as const,
      bookingId: String(existingBooking.id),
    };
  }

  const memberUpdate = await supabaseAdmin
    .from("shared_group_members")
    .update({
      status: "confirmed",
      amount_paid_pence: amountPence,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sharedGroupMemberId)
    .eq("shared_group_id", sharedGroupId)
    .in("status", ["pending", "confirmed"])
    .select("id, status, amount_paid_pence, stripe_checkout_session_id, stripe_payment_intent_id")
    .maybeSingle();

  if (memberUpdate.error) {
    debugLog({
      stage: "member_confirm_failed",
      session_id: session.id,
      error: memberUpdate.error,
    });
    return {
      handled: true as const,
      bookingId: existingBooking?.id ? String(existingBooking.id) : null,
      error: memberUpdate.error.message ?? "Failed to confirm shared-group member.",
      code: "SHARED_MEMBER_CONFIRM_FAILED",
    };
  }

  debugLog({
    stage: "pre_persist_state",
    session_id: session.id,
    booking_id: bookingId,
    shared_group_id: sharedGroupId,
    shared_group_member_id: sharedGroupMemberId,
    incoming_payment_status: session.payment_status ?? null,
    member_status_after: memberUpdate.data?.status ?? currentMemberResult.data?.status ?? null,
    existing_booking_status: existingBooking?.status ?? null,
    existing_booking_stripe_status: existingBooking?.stripe_status ?? null,
  });

  const bookingPayload = {
    listing_id: listingId,
    host_id: hostId,
    guest_id: guestId,
    status: resolvePaidBookingStatus(existingBooking?.status ?? "awaiting_payment", session.payment_status ?? "paid"),
    payout_status: "awaiting_payout",
    stay_type: "nightly",
    channel: "direct",
    check_in_time: toUtcStartIso(checkIn),
    check_out_time: toUtcStartIso(checkOut),
    nights,
    currency,
    price_total: amountPence / 100,
    host_net_total_pence: amountPence,
    guest_total_pence: amountPence,
    guest_unit_price_pence: guestUnitPricePence,
    booking_type: "shared_group",
    shared_group_id: sharedGroupId,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_status: "paid",
    amount: amountPence,
  };

  const persistSharedBooking = async (bookingId: string | null) => {
    let persistPayload: Record<string, any> = { ...bookingPayload };
    let persistError: any = null;
    let persistedId = bookingId;
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
      if (!persistedId) {
        const insertBooking = await supabaseAdmin
          .from("bookings")
          .insert(persistPayload)
          .select("id")
          .single();
        if (!insertBooking.error && insertBooking.data?.id) {
          return { bookingId: String(insertBooking.data.id), error: null };
        }
        persistError = insertBooking.error;
      } else {
        const updateBooking = await supabaseAdmin
          .from("bookings")
          .update(persistPayload)
          .eq("id", persistedId)
          .select("id")
          .single();
        if (!updateBooking.error && updateBooking.data?.id) {
          return { bookingId: String(updateBooking.data.id), error: null };
        }
        persistError = updateBooking.error;
      }

      if (!persistError || (!isMissingSharedSchema(persistError) && !isMissingBookingColumnError(persistError))) {
        break;
      }

      const missingColumns = extractMissingBookingColumns(persistError).filter((column) =>
        Object.prototype.hasOwnProperty.call(persistPayload, column)
      );
      if (missingColumns.length === 0) {
        break;
      }

      const missingCriticalColumns = missingColumns.filter((column) =>
        CRITICAL_SHARED_BOOKING_COLUMNS.has(column)
      );
      if (missingCriticalColumns.length > 0) {
        return {
          bookingId: persistedId,
          error: {
            message:
              "Booking schema is missing required shared-booking columns. Run latest migrations and retry.",
            details: persistError,
          },
        };
      }

      missingColumns.forEach((column) => {
        delete persistPayload[column];
      });
      attempts += 1;
    }

    return { bookingId: persistedId, error: persistError };
  };

  const persistedBooking = await persistSharedBooking(bookingId);
  if (persistedBooking.error) {
    debugLog({
      stage: bookingId ? "booking_update_failed" : "booking_create_failed",
      session_id: session.id,
      booking_id: bookingId,
      error: persistedBooking.error,
    });
    return {
      handled: true as const,
      bookingId: persistedBooking.bookingId ?? bookingId,
      error:
        persistedBooking.error?.message ??
        (bookingId ? "Failed to update shared booking." : "Failed to create shared booking."),
      code: bookingId ? "SHARED_BOOKING_UPDATE_FAILED" : "SHARED_BOOKING_CREATE_FAILED",
    };
  }
  bookingId = persistedBooking.bookingId ?? bookingId;

  if (bookingId) {
    const confirmStatePayloadBase = {
      status: "paid",
      stripe_status: "paid",
      payout_status: "awaiting_payout",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      amount: amountPence,
      price_total: amountPence / 100,
      currency,
      guest_total_pence: amountPence,
      guest_unit_price_pence: guestUnitPricePence,
    };
    let confirmStatePayload: Record<string, any> = { ...confirmStatePayloadBase };
    let confirmAttempts = 0;
    const maxConfirmAttempts = 20;
    while (confirmAttempts < maxConfirmAttempts) {
      const confirmUpdate = await supabaseAdmin
        .from("bookings")
        .update(confirmStatePayload)
        .eq("id", bookingId)
        .select("id, status, stripe_status, payout_status")
        .single();
      if (!confirmUpdate.error) {
        debugLog({
          stage: "booking_state_confirmed",
          session_id: session.id,
          booking_id: bookingId,
          status_after: confirmUpdate.data?.status ?? null,
          stripe_status_after: confirmUpdate.data?.stripe_status ?? null,
          payout_status_after: confirmUpdate.data?.payout_status ?? null,
        });
        break;
      }
      if (!isMissingSharedSchema(confirmUpdate.error) && !isMissingBookingColumnError(confirmUpdate.error)) {
        debugLog({
          stage: "booking_state_confirm_failed",
          session_id: session.id,
          booking_id: bookingId,
          error: confirmUpdate.error,
        });
        break;
      }
      const missingColumns = extractMissingBookingColumns(confirmUpdate.error).filter((column) =>
        Object.prototype.hasOwnProperty.call(confirmStatePayload, column)
      );
      if (missingColumns.length === 0) {
        debugLog({
          stage: "booking_state_confirm_failed_no_columns",
          session_id: session.id,
          booking_id: bookingId,
          error: confirmUpdate.error,
        });
        break;
      }
      const missingCriticalColumns = missingColumns.filter((column) =>
        CRITICAL_SHARED_BOOKING_COLUMNS.has(column)
      );
      if (missingCriticalColumns.length > 0) {
        debugLog({
          stage: "booking_state_confirm_missing_critical",
          session_id: session.id,
          booking_id: bookingId,
          missing_columns: missingCriticalColumns,
        });
        break;
      }
      missingColumns.forEach((column) => {
        delete confirmStatePayload[column];
      });
      confirmAttempts += 1;
    }
  }

  try {
    const reconciled = await reconcileSharedGroupOccupancy(supabaseAdmin, sharedGroupId);
    debugLog({
      stage: "shared_group_occupancy_updated",
      session_id: session.id,
      shared_group_id: sharedGroupId,
      booking_id: bookingId,
      confirmed_spots: reconciled.occupancy.confirmed,
      pending_spots: reconciled.occupancy.pending,
      active_spots: reconciled.occupancy.active,
      total_spots: reconciled.totalSpots,
      group_status: reconciled.groupStatus,
    });
  } catch (error) {
    debugLog({
      stage: "shared_group_occupancy_update_failed",
      session_id: session.id,
      shared_group_id: sharedGroupId,
      booking_id: bookingId,
      error,
    });
  }

  debugLog({
    stage: "complete",
    session_id: session.id,
    shared_group_id: sharedGroupId,
    shared_group_member_id: sharedGroupMemberId,
    booking_id: bookingId,
  });

  return {
    handled: true as const,
    bookingId,
  };
}
