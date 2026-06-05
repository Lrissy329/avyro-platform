import { stripe } from "@/lib/stripe";

type SupabaseLike = any;

type SendBookingEmailsParams = {
  supabaseAdmin: SupabaseLike;
  bookingId: string | null | undefined;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
};

type EmailProvider =
  | {
      name: "resend";
      apiKey: string;
    }
  | {
      name: "postmark";
      apiKey: string;
    };

type BookingEmailRecord = {
  id: string;
  listing_id: string | null;
  guest_id: string | null;
  host_id: string | null;
  status: string | null;
  booking_type?: string | null;
  stay_type?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  guest_total_pence?: number | null;
  price_total?: number | null;
  currency?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
};

type ListingEmailRecord = {
  id: string;
  title: string | null;
  location: string | null;
};

type ProfileEmailRecord = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type MarkerState = {
  guestSentAt: string | null;
  hostSentAt: string | null;
};

const EMAIL_FROM = process.env.EMAIL_FROM ?? "";
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const GUEST_SENT_KEY = "flexivo_guest_booking_email_sent_at";
const HOST_SENT_KEY = "flexivo_host_booking_email_sent_at";

const bookingSelects = [
  "id, listing_id, guest_id, host_id, status, booking_type, stay_type, check_in_time, check_out_time, check_in, check_out, guest_total_pence, price_total, currency, stripe_checkout_session_id, stripe_payment_intent_id",
  "id, listing_id, guest_id, host_id, status, stay_type, check_in_time, check_out_time, check_in, check_out, guest_total_pence, price_total, currency, stripe_checkout_session_id, stripe_payment_intent_id",
  "id, listing_id, guest_id, host_id, status, check_in_time, check_out_time, check_in, check_out, guest_total_pence, price_total, currency, stripe_checkout_session_id, stripe_payment_intent_id",
  "id, listing_id, guest_id, host_id, status, check_in, check_out, guest_total_pence, price_total, currency, stripe_checkout_session_id, stripe_payment_intent_id",
  "id, listing_id, guest_id, host_id, status, check_in, check_out, price_total, currency, stripe_checkout_session_id, stripe_payment_intent_id",
] as const;

const profileSelects = [
  "id, full_name, email",
  "id, email",
] as const;

const isMissingColumn = (error: any) => {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

const resolveProvider = (): EmailProvider | null => {
  if (process.env.RESEND_API_KEY) {
    return { name: "resend", apiKey: process.env.RESEND_API_KEY };
  }
  if (process.env.POSTMARK_SERVER_TOKEN) {
    return { name: "postmark", apiKey: process.env.POSTMARK_SERVER_TOKEN };
  }
  return null;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (value?: string | null) => {
  if (!value) return "TBC";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "TBC";
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const formatMoney = (currency: string | null | undefined, amountPence: number | null) => {
  const currencyCode = String(currency ?? "GBP").toUpperCase();
  const value = (amountPence ?? 0) / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(value);
};

const resolveBookingTypeLabel = (booking: BookingEmailRecord) => {
  const bookingType = String(booking.booking_type ?? "").toLowerCase();
  const stayType = String(booking.stay_type ?? "").toLowerCase();
  if (bookingType === "shared_group") return "Shared stay";
  if (stayType === "day_use" || stayType === "split_rest") return "Short stay";
  return "Stay";
};

const resolveAmountPence = (booking: BookingEmailRecord) => {
  if (typeof booking.guest_total_pence === "number" && booking.guest_total_pence > 0) {
    return booking.guest_total_pence;
  }
  if (typeof booking.price_total === "number" && booking.price_total > 0) {
    return Math.round(booking.price_total * 100);
  }
  return null;
};

async function loadBooking(
  supabaseAdmin: SupabaseLike,
  bookingId: string
): Promise<BookingEmailRecord | null> {
  let bookingRow: BookingEmailRecord | null = null;
  let bookingError: any = null;

  for (const select of bookingSelects) {
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select(select)
      .eq("id", bookingId)
      .maybeSingle();

    bookingRow = (data as BookingEmailRecord | null) ?? null;
    bookingError = error;

    if (!bookingError) break;
    if (!isMissingColumn(bookingError)) break;
  }

  if (bookingError) {
    throw new Error(bookingError.message ?? "Unable to load booking email details.");
  }

  return bookingRow;
}

async function loadProfile(
  supabaseAdmin: SupabaseLike,
  userId: string | null
): Promise<ProfileEmailRecord | null> {
  if (!userId) return null;

  for (const select of profileSelects) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(select)
      .eq("id", userId)
      .maybeSingle();

    if (!error) {
      return (data as ProfileEmailRecord | null) ?? null;
    }

    if (!isMissingColumn(error)) {
      throw new Error(error.message ?? "Unable to load profile email details.");
    }
  }

  return null;
}

async function readMarkerState({
  stripePaymentIntentId,
  stripeCheckoutSessionId,
}: {
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
}): Promise<MarkerState> {
  if (stripePaymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
      return {
        guestSentAt: paymentIntent.metadata?.[GUEST_SENT_KEY] ?? null,
        hostSentAt: paymentIntent.metadata?.[HOST_SENT_KEY] ?? null,
      };
    } catch (error) {
      console.warn("[booking-email] failed to read payment intent metadata", error);
    }
  }

  if (stripeCheckoutSessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(stripeCheckoutSessionId);
      return {
        guestSentAt: session.metadata?.[GUEST_SENT_KEY] ?? null,
        hostSentAt: session.metadata?.[HOST_SENT_KEY] ?? null,
      };
    } catch (error) {
      console.warn("[booking-email] failed to read checkout session metadata", error);
    }
  }

  return {
    guestSentAt: null,
    hostSentAt: null,
  };
}

async function markEmailSent({
  stripePaymentIntentId,
  stripeCheckoutSessionId,
  key,
}: {
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  key: string;
}) {
  const timestamp = new Date().toISOString();

  if (stripePaymentIntentId) {
    await stripe.paymentIntents.update(stripePaymentIntentId, {
      metadata: {
        [key]: timestamp,
      },
    });
    return;
  }

  if (stripeCheckoutSessionId) {
    await stripe.checkout.sessions.update(stripeCheckoutSessionId, {
      metadata: {
        [key]: timestamp,
      },
    });
  }
}

async function sendProviderEmail({
  provider,
  to,
  subject,
  text,
  html,
}: {
  provider: EmailProvider;
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  if (provider.name === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend send failed: ${response.status} ${body}`);
    }
    return;
  }

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": provider.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      From: EMAIL_FROM,
      To: to,
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Postmark send failed: ${response.status} ${body}`);
  }
}

export async function sendBookingEmails(params: SendBookingEmailsParams) {
  const { supabaseAdmin, bookingId } = params;

  if (!bookingId) {
    return { provider: null, guestSent: false, hostSent: false, skipped: "missing_booking_id" };
  }

  const provider = resolveProvider();
  if (!provider || !EMAIL_FROM) {
    console.warn(
      `[booking-email] email provider not configured; skipping booking emails for ${bookingId}`
    );
    return {
      provider: provider?.name ?? null,
      guestSent: false,
      hostSent: false,
      skipped: "provider_not_configured",
    };
  }

  const booking = await loadBooking(supabaseAdmin, bookingId);
  if (!booking) {
    return { provider: provider.name, guestSent: false, hostSent: false, skipped: "booking_not_found" };
  }

  const listingPromise = booking.listing_id
    ? supabaseAdmin
        .from("listings")
        .select("id, title, location")
        .eq("id", booking.listing_id)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const guestPromise = loadProfile(supabaseAdmin, booking.guest_id);
  const hostPromise = loadProfile(supabaseAdmin, booking.host_id);
  const markerPromise = readMarkerState({
    stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? booking.stripe_checkout_session_id ?? null,
    stripePaymentIntentId: params.stripePaymentIntentId ?? booking.stripe_payment_intent_id ?? null,
  });

  const [{ data: listingRow, error: listingError }, guestProfile, hostProfile, markerState] =
    await Promise.all([listingPromise, guestPromise, hostPromise, markerPromise]);

  if (listingError) {
    throw new Error(listingError.message ?? "Unable to load listing email details.");
  }

  const listing = (listingRow as ListingEmailRecord | null) ?? null;
  const checkIn = booking.check_in_time ?? booking.check_in ?? null;
  const checkOut = booking.check_out_time ?? booking.check_out ?? null;
  const amountPence = resolveAmountPence(booking);
  const totalPaidLabel = formatMoney(booking.currency, amountPence);
  const bookingReference = booking.id;
  const listingTitle = listing?.title?.trim() || "Flexivo stay";
  const listingLocation = listing?.location?.trim() || "Location shared in your dashboard";
  const guestName = guestProfile?.full_name?.trim() || "Guest";
  const hostName = hostProfile?.full_name?.trim() || "Host";
  const bookingTypeLabel = resolveBookingTypeLabel(booking);
  const guestDashboardUrl = `${SITE_URL}/guest/dashboard`;
  const hostBookingUrl = `${SITE_URL}/host/bookings/${booking.id}`;

  const guestHtml = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
      <p>Your stay is confirmed.</p>
      <p><strong>${escapeHtml(listingTitle)}</strong><br />${escapeHtml(listingLocation)}</p>
      <p>
        Dates: ${escapeHtml(formatDate(checkIn))} to ${escapeHtml(formatDate(checkOut))}<br />
        Total paid: ${escapeHtml(totalPaidLabel)}<br />
        Booking reference: ${escapeHtml(bookingReference)}<br />
        Type: ${escapeHtml(bookingTypeLabel)}
      </p>
      <p>View your booking: <a href="${guestDashboardUrl}">${guestDashboardUrl}</a></p>
      <p>Built for practical airport-area stays and repeat travel.</p>
    </div>
  `.trim();

  const guestText = [
    "Your stay is confirmed.",
    "",
    `Listing: ${listingTitle}`,
    `Location: ${listingLocation}`,
    `Dates: ${formatDate(checkIn)} to ${formatDate(checkOut)}`,
    `Total paid: ${totalPaidLabel}`,
    `Booking reference: ${bookingReference}`,
    `Type: ${bookingTypeLabel}`,
    `View booking: ${guestDashboardUrl}`,
  ].join("\n");

  const hostHtml = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
      <p>You have a new booking.</p>
      <p><strong>${escapeHtml(listingTitle)}</strong><br />${escapeHtml(listingLocation)}</p>
      <p>
        Guest: ${escapeHtml(guestName)}<br />
        Dates: ${escapeHtml(formatDate(checkIn))} to ${escapeHtml(formatDate(checkOut))}<br />
        Amount: ${escapeHtml(totalPaidLabel)}<br />
        Booking reference: ${escapeHtml(bookingReference)}
      </p>
      <p>View booking: <a href="${hostBookingUrl}">${hostBookingUrl}</a></p>
      <p>Designed for early starts, late finishes, and practical airport-area stays.</p>
    </div>
  `.trim();

  const hostText = [
    "You have a new booking.",
    "",
    `Guest: ${guestName}`,
    `Listing: ${listingTitle}`,
    `Location: ${listingLocation}`,
    `Dates: ${formatDate(checkIn)} to ${formatDate(checkOut)}`,
    `Amount: ${totalPaidLabel}`,
    `Booking reference: ${bookingReference}`,
    `View booking: ${hostBookingUrl}`,
  ].join("\n");

  let guestSent = false;
  let hostSent = false;

  const sessionId = params.stripeCheckoutSessionId ?? booking.stripe_checkout_session_id ?? null;
  const paymentIntentId = params.stripePaymentIntentId ?? booking.stripe_payment_intent_id ?? null;

  if (!markerState.guestSentAt) {
    if (guestProfile?.email) {
      await sendProviderEmail({
        provider,
        to: guestProfile.email,
        subject: "Your Flexivo booking is confirmed",
        html: guestHtml,
        text: guestText,
      });
      await markEmailSent({
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
        key: GUEST_SENT_KEY,
      });
      guestSent = true;
    } else {
      console.warn(`[booking-email] guest email missing for booking ${bookingId}`);
    }
  }

  if (!markerState.hostSentAt) {
    if (hostProfile?.email) {
      await sendProviderEmail({
        provider,
        to: hostProfile.email,
        subject: "New Flexivo booking received",
        html: hostHtml,
        text: hostText,
      });
      await markEmailSent({
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
        key: HOST_SENT_KEY,
      });
      hostSent = true;
    } else {
      console.warn(`[booking-email] host email missing for booking ${bookingId}`);
    }
  }

  return {
    provider: provider.name,
    guestSent,
    hostSent,
    guestAlreadySent: Boolean(markerState.guestSentAt),
    hostAlreadySent: Boolean(markerState.hostSentAt),
  };
}
