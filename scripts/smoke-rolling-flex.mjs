import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const ENV_FILES = [".env.local", ".env"];
const ROLLING_CREATE_ATTEMPTS = 48;
const ROLLING_START_OFFSET_DAYS = 21;
const ROLLING_ATTEMPT_STEP_DAYS = 14;

const log = (message, data) => {
  if (data === undefined) {
    console.log(`[smoke:rolling-flex] ${message}`);
    return;
  }
  console.log(`[smoke:rolling-flex] ${message}`, data);
};

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] != null) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
};

for (const envFile of ENV_FILES) {
  loadEnvFile(path.join(process.cwd(), envFile));
}

const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const baseUrl = String(process.argv[2] || process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const newAnonClient = () =>
  createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const cookieName = `sb-${projectRef}-auth-token`;
const sessionToCookie = (session) => {
  const packed = JSON.stringify([
    session.access_token,
    session.refresh_token,
    session.provider_token ?? null,
    session.provider_refresh_token ?? null,
    session.user?.factors ?? null,
  ]);
  return `${cookieName}=${encodeURIComponent(packed)}`;
};

const toIsoDate = (date) => date.toISOString().slice(0, 10);
const addDaysUtc = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};
const enumerateDates = (startIso, endIsoExclusive) => {
  const nights = [];
  let cursor = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIsoExclusive}T00:00:00Z`);
  while (cursor < end) {
    nights.push(toIsoDate(cursor));
    cursor = addDaysUtc(cursor, 1);
  }
  return nights;
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
};

const ensureLocalServer = async () => {
  const check = await fetch(`${baseUrl}/`, { method: "GET" }).catch(() => null);
  if (!check || !check.ok) {
    throw new Error(
      `Cannot reach ${baseUrl}. Start Next.js first (e.g. \`npm run dev\`) and rerun this smoke test.`
    );
  }
};

const state = {
  hostUserId: null,
  guestUserId: null,
  listingId: null,
  listingOriginal: null,
  bookingId: null,
};

const cleanup = async () => {
  const warnings = [];

  if (state.bookingId) {
    const { error } = await admin.from("bookings").delete().eq("id", state.bookingId);
    if (error) warnings.push(`failed to delete booking ${state.bookingId}: ${error.message}`);
  }

  if (state.listingId && state.listingOriginal) {
    const { error } = await admin
      .from("listings")
      .update(state.listingOriginal)
      .eq("id", state.listingId);
    if (error) warnings.push(`failed to restore listing ${state.listingId}: ${error.message}`);
  }

  const profileIds = [state.hostUserId, state.guestUserId].filter(Boolean);
  if (profileIds.length > 0) {
    const { error } = await admin.from("profiles").delete().in("id", profileIds);
    if (error) warnings.push(`failed to delete temp profiles: ${error.message}`);
  }

  for (const userId of [state.hostUserId, state.guestUserId]) {
    if (!userId) continue;
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) warnings.push(`failed to delete auth user ${userId}: ${error.message}`);
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      log(`cleanup warning: ${warning}`);
    }
  }
};

const pickListing = async () => {
  const { data, error } = await admin
    .from("listings")
    .select(
      "id, user_id, title, rental_type, booking_unit, price_per_night, allow_flexible_stays, flexible_stay_mode, flex_min_commitment_nights, flex_max_extension_nights, flex_rolling_window_days, flex_pricing_multiplier"
    )
    .not("price_per_night", "is", null)
    .gt("price_per_night", 0)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Unable to fetch listings: ${error.message}`);
  }
  const listing = (data ?? []).find((row) => {
    const rentalType = String(row.rental_type ?? "").toLowerCase();
    const bookingUnit = String(row.booking_unit ?? "").toLowerCase();
    if (["day_use", "split_rest", "crashpad"].includes(rentalType)) return false;
    if (bookingUnit === "hourly") return false;
    return true;
  });
  if (!listing?.id) {
    throw new Error("No nightly listing with price was found for smoke testing.");
  }
  return listing;
};

const createTempUser = async ({ email, password, fullName }) => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user?.id) {
    throw new Error(`Failed to create temp user ${email}: ${error?.message ?? "unknown error"}`);
  }
  return data.user.id;
};

const main = async () => {
  await ensureLocalServer();
  log(`running against ${baseUrl}`);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const hostEmail = `rolling-host-${suffix}@example.com`;
  const guestEmail = `rolling-guest-${suffix}@example.com`;
  const password = `Avyro!${Math.floor(Math.random() * 1_000_000_000)}aA`;

  state.hostUserId = await createTempUser({
    email: hostEmail,
    password,
    fullName: "Rolling Smoke Host",
  });
  state.guestUserId = await createTempUser({
    email: guestEmail,
    password,
    fullName: "Rolling Smoke Guest",
  });

  const profileUpsert = await admin.from("profiles").upsert(
    [
      { id: state.hostUserId, full_name: "Rolling Smoke Host", verification_level: 2 },
      { id: state.guestUserId, full_name: "Rolling Smoke Guest", verification_level: 2 },
    ],
    { onConflict: "id" }
  );
  if (profileUpsert.error) {
    throw new Error(`Failed to upsert profiles: ${profileUpsert.error.message}`);
  }

  const listing = await pickListing();
  state.listingId = listing.id;
  state.listingOriginal = {
    user_id: listing.user_id,
    allow_flexible_stays: listing.allow_flexible_stays,
    flexible_stay_mode: listing.flexible_stay_mode,
    flex_min_commitment_nights: listing.flex_min_commitment_nights,
    flex_max_extension_nights: listing.flex_max_extension_nights,
    flex_rolling_window_days: listing.flex_rolling_window_days,
    flex_pricing_multiplier: listing.flex_pricing_multiplier,
  };

  const listingUpdate = await admin
    .from("listings")
    .update({
      user_id: state.hostUserId,
      allow_flexible_stays: true,
      flexible_stay_mode: "rolling",
      flex_min_commitment_nights: 7,
      flex_max_extension_nights: 14,
      flex_rolling_window_days: 3,
      flex_pricing_multiplier: 1.1,
    })
    .eq("id", state.listingId);
  if (listingUpdate.error) {
    throw new Error(
      `Failed to update listing for rolling smoke test: ${listingUpdate.error.message}`
    );
  }

  const hostClient = newAnonClient();
  const hostSignIn = await hostClient.auth.signInWithPassword({ email: hostEmail, password });
  if (hostSignIn.error || !hostSignIn.data.session) {
    throw new Error(`Host sign-in failed: ${hostSignIn.error?.message ?? "no session"}`);
  }
  const hostCookie = sessionToCookie(hostSignIn.data.session);

  const guestClient = newAnonClient();
  const guestSignIn = await guestClient.auth.signInWithPassword({ email: guestEmail, password });
  if (guestSignIn.error || !guestSignIn.data.session) {
    throw new Error(`Guest sign-in failed: ${guestSignIn.error?.message ?? "no session"}`);
  }
  const guestCookie = sessionToCookie(guestSignIn.data.session);
  const guestBearer = guestSignIn.data.session.access_token;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let checkInIso = null;
  let checkOutIso = null;
  for (let attempt = 0; attempt < ROLLING_CREATE_ATTEMPTS; attempt += 1) {
    const checkIn = addDaysUtc(today, ROLLING_START_OFFSET_DAYS + attempt * ROLLING_ATTEMPT_STEP_DAYS);
    const checkOut = addDaysUtc(checkIn, 7);
    const candidateCheckIn = toIsoDate(checkIn);
    const candidateCheckOut = toIsoDate(checkOut);
    const { response, body } = await fetchJson(`${baseUrl}/api/bookings/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${guestBearer}`,
      },
      body: JSON.stringify({
        listingId: state.listingId,
        checkIn: candidateCheckIn,
        checkOut: candidateCheckOut,
        guests: 1,
        bookingMode: "rolling",
        flexMinNights: 7,
        flexMaxNights: 21,
        flexRollingWindowDays: 3,
      }),
    });

    if (response.ok && body.bookingId) {
      state.bookingId = String(body.bookingId);
      checkInIso = candidateCheckIn;
      checkOutIso = candidateCheckOut;
      break;
    }

    const message = String(body?.error ?? "").toLowerCase();
    const overlap =
      message.includes("no_overlap") ||
      message.includes("exclusion constraint") ||
      message.includes("conflicting key value");

    if (!overlap) {
      throw new Error(
        `Booking creation failed on attempt ${attempt + 1}: ${response.status} ${JSON.stringify(body)}`
      );
    }
  }

  if (!state.bookingId || !checkInIso || !checkOutIso) {
    throw new Error("Could not create a rolling booking after multiple non-overlapping attempts.");
  }
  log(`created rolling booking ${state.bookingId}`);

  const { data: bookingRow, error: bookingError } = await admin
    .from("bookings")
    .select(
      "id, status, flex_mode, flex_status, flex_min_nights, flex_max_nights, flex_current_confirmed_end, flex_max_end, flex_rolling_window_days, flex_extension_cutoff_at"
    )
    .eq("id", state.bookingId)
    .maybeSingle();
  if (bookingError || !bookingRow) {
    throw new Error(`Failed to load booking row: ${bookingError?.message ?? "missing booking"}`);
  }

  const { data: initialHeldWindow, error: heldWindowError } = await admin
    .from("booking_flex_windows")
    .select("id, booking_id, start_date, end_date, status, cutoff_at")
    .eq("booking_id", state.bookingId)
    .eq("status", "held")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (heldWindowError || !initialHeldWindow) {
    throw new Error(
      `Failed to load initial held flex window: ${heldWindowError?.message ?? "missing held window"}`
    );
  }

  const availabilityStart = new Date(`${checkInIso}T00:00:00Z`);
  const availabilityEnd = addDaysUtc(availabilityStart, 28);
  const availabilityUrl = `${baseUrl}/api/listings/${state.listingId}/availability?from=${toIsoDate(
    availabilityStart
  )}&to=${toIsoDate(availabilityEnd)}`;
  const availabilityBefore = await fetchJson(availabilityUrl);
  if (!availabilityBefore.response.ok) {
    throw new Error(
      `Availability check failed: ${availabilityBefore.response.status} ${JSON.stringify(
        availabilityBefore.body
      )}`
    );
  }

  const heldDatesInitiallyBlocked = enumerateDates(
    initialHeldWindow.start_date,
    initialHeldWindow.end_date
  );
  const missingBlockedDates = heldDatesInitiallyBlocked.filter(
    (night) => !(availabilityBefore.body?.blocked ?? []).includes(night)
  );
  if (missingBlockedDates.length > 0) {
    throw new Error(
      `Availability does not block held rolling dates: ${missingBlockedDates.join(", ")}`
    );
  }

  const hostFeed = await fetchJson(
    `${baseUrl}/api/host/calendar/feed?start=${toIsoDate(availabilityStart)}&end=${toIsoDate(
      availabilityEnd
    )}`,
    { headers: { Cookie: hostCookie } }
  );
  if (!hostFeed.response.ok) {
    throw new Error(`Host feed failed: ${hostFeed.response.status} ${JSON.stringify(hostFeed.body)}`);
  }

  const hasRollingBooking = Array.isArray(hostFeed.body?.bookings)
    ? hostFeed.body.bookings.some(
        (booking) => String(booking.id ?? "") === state.bookingId && String(booking.flexMode ?? "") === "rolling"
      )
    : false;
  if (!hasRollingBooking) {
    throw new Error("Host feed does not include rolling booking metadata.");
  }

  const hasRollingHeldBlock = Array.isArray(hostFeed.body?.blocks)
    ? hostFeed.body.blocks.some(
        (block) =>
          block.blockType === "flex_rolling_held" && String(block.bookingId ?? "") === state.bookingId
      )
    : false;
  if (!hasRollingHeldBlock) {
    throw new Error("Host feed does not include flex_rolling_held block.");
  }

  const statusToPaid = await admin.from("bookings").update({ status: "paid" }).eq("id", state.bookingId);
  if (statusToPaid.error) {
    throw new Error(`Failed to set booking status to paid: ${statusToPaid.error.message}`);
  }

  const extendAttempt = await fetchJson(`${baseUrl}/api/flex/extend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guestCookie,
    },
    body: JSON.stringify({ bookingId: state.bookingId }),
  });

  let extendOutcome = "failed";
  if (extendAttempt.response.ok && extendAttempt.body?.ok) {
    extendOutcome = "extended";
  } else if (
    extendAttempt.response.status === 409 &&
    String(extendAttempt.body?.code ?? "") === "FLEX_PAYMENT_METHOD_MISSING"
  ) {
    extendOutcome = "missing_payment_method";
  } else {
    throw new Error(
      `Unexpected extend outcome: ${extendAttempt.response.status} ${JSON.stringify(extendAttempt.body)}`
    );
  }

  const { data: heldWindowBeforeRelease, error: beforeReleaseError } = await admin
    .from("booking_flex_windows")
    .select("id, start_date, end_date, status")
    .eq("booking_id", state.bookingId)
    .eq("status", "held")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (beforeReleaseError) {
    throw new Error(`Failed to load held window before release: ${beforeReleaseError.message}`);
  }

  const releaseAttempt = await fetchJson(`${baseUrl}/api/flex/release`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guestCookie,
    },
    body: JSON.stringify({ bookingId: state.bookingId }),
  });
  if (!releaseAttempt.response.ok || !releaseAttempt.body?.ok) {
    throw new Error(
      `Release failed: ${releaseAttempt.response.status} ${JSON.stringify(releaseAttempt.body)}`
    );
  }

  const { data: heldWindowAfterRelease, error: afterReleaseError } = await admin
    .from("booking_flex_windows")
    .select("id, status")
    .eq("booking_id", state.bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (afterReleaseError || !heldWindowAfterRelease) {
    throw new Error(
      `Failed to load held window status after release: ${afterReleaseError?.message ?? "missing"}`
    );
  }

  const availabilityAfter = await fetchJson(availabilityUrl);
  if (!availabilityAfter.response.ok) {
    throw new Error(
      `Availability after release failed: ${availabilityAfter.response.status} ${JSON.stringify(
        availabilityAfter.body
      )}`
    );
  }

  let releasedWindowBlockedNights = [];
  if (heldWindowBeforeRelease?.start_date && heldWindowBeforeRelease?.end_date) {
    const releasedWindowNights = enumerateDates(
      heldWindowBeforeRelease.start_date,
      heldWindowBeforeRelease.end_date
    );
    releasedWindowBlockedNights = releasedWindowNights.filter((night) =>
      (availabilityAfter.body?.blocked ?? []).includes(night)
    );
  }

  const summary = {
    ok: true,
    baseUrl,
    listingId: state.listingId,
    booking: {
      id: state.bookingId,
      selectedCheckIn: checkInIso,
      selectedCheckOut: checkOutIso,
      flexMode: bookingRow.flex_mode,
      flexStatus: bookingRow.flex_status,
      flexMinNights: bookingRow.flex_min_nights,
      flexMaxNights: bookingRow.flex_max_nights,
      flexCurrentConfirmedEnd: bookingRow.flex_current_confirmed_end,
      flexMaxEnd: bookingRow.flex_max_end,
      flexRollingWindowDays: bookingRow.flex_rolling_window_days,
    },
    initialHeldWindow,
    hostFeed: {
      hasRollingBooking,
      hasRollingHeldBlock,
      bookingsCount: Array.isArray(hostFeed.body?.bookings) ? hostFeed.body.bookings.length : 0,
      blocksCount: Array.isArray(hostFeed.body?.blocks) ? hostFeed.body.blocks.length : 0,
    },
    availability: {
      blockedCountBeforeRelease: (availabilityBefore.body?.blocked ?? []).length,
      blockedCountAfterRelease: (availabilityAfter.body?.blocked ?? []).length,
      releasedWindowBlockedNights,
    },
    extend: {
      outcome: extendOutcome,
      status: extendAttempt.response.status,
      code: extendAttempt.body?.code ?? null,
    },
    release: {
      status: releaseAttempt.response.status,
      bookingFlexStatus: releaseAttempt.body?.booking?.flexStatus ?? null,
      latestWindowStatus: heldWindowAfterRelease.status,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
};

try {
  await main();
} catch (error) {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
}
