import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsAlertRow from "@/components/ops/OpsAlertRow";
import OpsEmptyState from "@/components/ops/OpsEmptyState";
import OpsErrorPanel from "@/components/ops/OpsErrorPanel";
import OpsLayout from "@/components/ops/OpsLayout";
import OpsMetric from "@/components/ops/OpsMetric";
import OpsPageHeader from "@/components/ops/OpsPageHeader";
import OpsSearchBar from "@/components/ops/OpsSearchBar";
import OpsSection from "@/components/ops/OpsSection";
import type { OpsStatusTone } from "@/components/ops/OpsStatusBadge";
import { isPaidFinalBookingStatus } from "@/lib/bookingStatus";
import { type ListingReadiness, evaluateListingReadiness } from "@/lib/listingReadiness";
import { requireOpsStaff } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type BookingRow = {
  id: string;
  listing_id: string | null;
  guest_id: string | null;
  host_id: string | null;
  status: string | null;
  stripe_status?: string | null;
  payout_status?: string | null;
  needs_review?: boolean | null;
  guest_total_pence?: number | null;
  price_total?: number | null;
  currency?: string | null;
  created_at?: string | null;
};

type VerificationRow = {
  user_id: string;
  status: string | null;
  created_at: string | null;
  reviewed_at?: string | null;
};

type CaseRow = {
  id: string;
  status: string | null;
  priority: string | null;
  subject: string | null;
  last_activity_at: string | null;
};

type ListingRow = {
  id: string;
  user_id: string | null;
  title: string | null;
  location: string | null;
  booking_unit: "nightly" | "hourly" | null;
  rental_type?: string | null;
  price_per_night?: number | null;
  price_per_hour?: number | null;
  is_shared_stay?: boolean | null;
  shared_weekly_price_pence?: number | null;
  airport_code?: string | null;
  photos?: string[] | null;
  created_at?: string | null;
};

type HostProfile = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  stripe_account_id?: string | null;
  stripe_onboarding_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  meta?: string;
  href: string;
  tone: OpsStatusTone;
  badgeLabel?: string;
};

type AttentionGroup = {
  key: string;
  title: string;
  description: string;
  href: string;
  empty: string;
  items: AttentionItem[];
};

type AttentionSection = {
  key: string;
  title: string;
  description: string;
  groups: AttentionGroup[];
};

type MetricCard = {
  label: string;
  value: string;
  detail: string;
  href: string;
  tone: OpsStatusTone;
  statusLabel?: string;
  dominant?: boolean;
};

type ListingReadinessRow = {
  listing: ListingRow;
  readiness: ListingReadiness;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  at: string;
  meta?: string;
  tone: OpsStatusTone;
};

type PageProps = {
  staffRole: OpsRole;
  marketplaceStatus: {
    label: string;
    tone: OpsStatusTone;
    detail: string;
  };
  metrics: MetricCard[];
  attention: AttentionSection[];
  activity: ActivityItem[];
  errors: string[];
};

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

const isMissingRelation = (error: any, relation: string) => {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42p01" && message.includes("relation") && message.includes(relation.toLowerCase());
};

const parseDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const DASHBOARD_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const formatDateTime = (value?: string | null) => {
  const date = parseDate(value);
  if (!date) return "—";
  const parts = Object.fromEntries(
    DASHBOARD_DATE_TIME.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.day ?? ""} ${parts.month ?? ""} ${parts.hour ?? ""}:${parts.minute ?? ""}`.trim();
};

const formatCurrency = (amountPence: number, currency = "GBP") =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: amountPence % 100 === 0 ? 0 : 2,
  }).format(amountPence / 100);

const getCurrencyPence = (booking: BookingRow) => {
  const guestTotal = Number(booking.guest_total_pence ?? NaN);
  if (Number.isFinite(guestTotal) && guestTotal > 0) return Math.round(guestTotal);

  const totalMajor = Number(booking.price_total ?? NaN);
  if (Number.isFinite(totalMajor) && totalMajor > 0) return Math.round(totalMajor * 100);

  return 0;
};

const formatPriority = (value?: string | null) => {
  if (!value) return "Normal";
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
};

const getListingDisplayName = (listing: ListingRow) =>
  listing.title?.trim() || `Listing ${listing.id.slice(0, 8)}`;

const getProfileName = (profile?: HostProfile | null) =>
  profile?.full_name?.trim() || profile?.email?.trim() || profile?.id.slice(0, 8) || "Host";

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:dashboard:ops" });
  if ("redirect" in guard) return guard;

  const admin = getSupabaseServerClient();
  const errors: string[] = [];
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const bookingsPromise = admin
    .from("bookings")
    .select(
      "id, listing_id, guest_id, host_id, status, stripe_status, payout_status, needs_review, guest_total_pence, price_total, currency, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(400);
  const verificationPromise = admin
    .from("guest_verifications")
    .select("user_id, status, created_at, reviewed_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const casesPromise = admin
    .from("cases")
    .select("id, status, priority, subject, last_activity_at")
    .order("last_activity_at", { ascending: false })
    .limit(200);

  const listingSelects = [
    "id, user_id, title, location, booking_unit, rental_type, price_per_night, price_per_hour, is_shared_stay, shared_weekly_price_pence, airport_code, photos, created_at",
    "id, user_id, title, location, booking_unit, rental_type, price_per_night, price_per_hour, is_shared_stay, airport_code, photos, created_at",
    "id, user_id, title, location, booking_unit, price_per_night, price_per_hour, is_shared_stay, airport_code, photos, created_at",
    "id, user_id, title, location, booking_unit, price_per_night, is_shared_stay, airport_code, photos, created_at",
    "id, user_id, title, location, booking_unit, price_per_night, created_at",
  ];

  let listings: ListingRow[] = [];
  let listingsError: any = null;
  for (const select of listingSelects) {
    const result = await admin
      .from("listings")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(300);
    listings = (result.data as unknown as ListingRow[]) ?? [];
    listingsError = result.error;
    if (!listingsError) break;
    if (!isMissingColumn(listingsError)) break;
  }
  if (listingsError) {
    errors.push(`Listings could not be loaded: ${listingsError.message}`);
    listings = [];
  }

  const uniqueHostIds = Array.from(
    new Set(listings.map((listing) => listing.user_id).filter((id): id is string => Boolean(id)))
  );
  const profileSelects = [
    "id, full_name, email, stripe_account_id, stripe_onboarding_status, updated_at, created_at",
    "id, full_name, email, stripe_account_id, stripe_onboarding_status, created_at",
    "id, full_name, email, stripe_account_id, stripe_onboarding_status",
  ];

  let hostProfiles: HostProfile[] = [];
  if (uniqueHostIds.length > 0) {
    let hostError: any = null;
    for (const select of profileSelects) {
      const result = await admin.from("profiles").select(select).in("id", uniqueHostIds);
      hostProfiles = (result.data as unknown as HostProfile[]) ?? [];
      hostError = result.error;
      if (!hostError) break;
      if (!isMissingColumn(hostError)) break;
    }
    if (hostError) {
      errors.push(`Host payout state could not be loaded: ${hostError.message}`);
      hostProfiles = [];
    }
  }

  const [bookingsRes, verificationRes, casesRes] = await Promise.all([
    bookingsPromise,
    verificationPromise,
    casesPromise,
  ]);

  if (bookingsRes.error) errors.push(`Bookings could not be loaded: ${bookingsRes.error.message}`);
  if (verificationRes.error) {
    errors.push(`Verification queue could not be loaded: ${verificationRes.error.message}`);
  }
  if (casesRes.error && !isMissingRelation(casesRes.error, "public.cases")) {
    errors.push(`Cases could not be loaded: ${casesRes.error.message}`);
  }

  const bookings = (bookingsRes.data ?? []) as BookingRow[];
  const verifications = (verificationRes.data ?? []) as VerificationRow[];
  const casesUnavailable = isMissingRelation(casesRes.error, "public.cases");
  const cases = casesUnavailable ? [] : (((casesRes.data ?? []) as CaseRow[]) ?? []);

  const hostProfileMap = new Map(hostProfiles.map((profile) => [profile.id, profile]));
  const listingMap = new Map(listings.map((listing) => [listing.id, listing]));

  const readinessRows: ListingReadinessRow[] = listings.map((listing) => {
    const host = listing.user_id ? hostProfileMap.get(listing.user_id) ?? null : null;
    const stripeConnected =
      Boolean(host?.stripe_account_id) &&
      String(host?.stripe_onboarding_status ?? "").toLowerCase() === "complete";

    return {
      listing,
      readiness: evaluateListingReadiness(listing, {
        stripeConnected,
        availabilityConfigured: true,
      }),
    };
  });

  const recentBookings30d = bookings.filter((booking) => {
    const createdAt = parseDate(booking.created_at);
    return createdAt ? createdAt.getTime() >= thirtyDaysAgo : false;
  });
  const paidBookings30d = recentBookings30d.filter((booking) => isPaidFinalBookingStatus(booking.status));
  const revenue30dPence = paidBookings30d.reduce((sum, booking) => sum + getCurrencyPence(booking), 0);
  const pendingVerificationRows = verifications.filter(
    (row) => String(row.status ?? "").toLowerCase() === "pending"
  );
  const openCases = cases.filter((row) =>
    ["open", "pending"].includes(String(row.status ?? "").toLowerCase())
  );
  const searchReadyListings = readinessRows.filter((row) => row.readiness.status === "search_ready");
  const listingsNeedingAction = readinessRows.filter((row) => row.readiness.status !== "search_ready");

  const bookingsAwaitingTooLong = recentBookings30d
    .filter((booking) => {
      const status = String(booking.status ?? "").toLowerCase();
      if (!["awaiting_payment", "pending_payment"].includes(status)) return false;
      const createdAt = parseDate(booking.created_at);
      return createdAt ? Date.now() - createdAt.getTime() > 2 * 60 * 60 * 1000 : false;
    })
    .slice(0, 5)
    .map<AttentionItem>((booking) => ({
      id: booking.id,
      title: `Payment pending · ${booking.id.slice(0, 8)}`,
      detail: listingMap.get(booking.listing_id ?? "")?.title?.trim() || "Booking awaiting payment",
      meta: `Created ${formatDateTime(booking.created_at)}`,
      href: `/ops/bookings/${booking.id}`,
      tone: "warning",
      badgeLabel: "Needs action",
    }));

  const failedPayouts = bookings
    .filter((booking) => String(booking.payout_status ?? "").toLowerCase() === "failed")
    .slice(0, 5)
    .map<AttentionItem>((booking) => ({
      id: booking.id,
      title: `Failed payout · ${booking.id.slice(0, 8)}`,
      detail: listingMap.get(booking.listing_id ?? "")?.title?.trim() || "Payout failed",
      meta: booking.host_id ? `Host ${booking.host_id.slice(0, 8)}` : "Host not linked",
      href: `/ops/bookings/${booking.id}?tab=payout`,
      tone: "danger",
      badgeLabel: "Critical",
    }));

  const pendingVerifications = pendingVerificationRows.slice(0, 5).map<AttentionItem>((row) => ({
    id: row.user_id,
    title: `Verification pending · ${row.user_id.slice(0, 8)}`,
    detail: "Guest review required before booking confidence improves.",
    meta: `Submitted ${formatDateTime(row.created_at)}`,
    href: `/ops/verification/${row.user_id}`,
    tone: "warning",
    badgeLabel: "Queue",
  }));

  const notSearchReady = listingsNeedingAction.slice(0, 5).map<AttentionItem>((row) => ({
    id: row.listing.id,
    title: getListingDisplayName(row.listing),
    detail: row.readiness.reasons[0] ?? "Needs action before public search visibility",
    meta: row.listing.airport_code ? `Airport ${row.listing.airport_code}` : "Airport not set",
    href: `/ops/listings?q=${row.listing.id}`,
    tone: "warning",
    badgeLabel: "Needs action",
  }));

  const payoutAnomalies = bookings
    .filter((booking) => {
      if (!isPaidFinalBookingStatus(booking.status)) return false;
      const payoutStatus = String(booking.payout_status ?? "").toLowerCase();
      return !payoutStatus || payoutStatus === "failed";
    })
    .slice(0, 5)
    .map<AttentionItem>((booking) => ({
      id: booking.id,
      title: `Payout anomaly · ${booking.id.slice(0, 8)}`,
      detail: listingMap.get(booking.listing_id ?? "")?.title?.trim() || "Paid booking",
      meta: booking.payout_status ? `Payout ${booking.payout_status}` : "Missing payout status",
      href: `/ops/bookings/${booking.id}?tab=payout`,
      tone: "danger",
      badgeLabel: "Critical",
    }));

  const cancelledFinanciallyActive = bookings
    .filter((booking) => {
      const status = String(booking.status ?? "").toLowerCase();
      if (status !== "cancelled") return false;
      const stripeStatus = String(booking.stripe_status ?? "").toLowerCase();
      const payoutStatus = String(booking.payout_status ?? "").toLowerCase();
      return ["paid", "succeeded", "complete"].includes(stripeStatus) || payoutStatus === "awaiting_payout";
    })
    .slice(0, 5)
    .map<AttentionItem>((booking) => ({
      id: booking.id,
      title: `Cancelled but financially active · ${booking.id.slice(0, 8)}`,
      detail: listingMap.get(booking.listing_id ?? "")?.title?.trim() || "Booking needs review",
      meta: booking.stripe_status ? `Stripe ${booking.stripe_status}` : "Payment state unclear",
      href: `/ops/bookings/${booking.id}`,
      tone: "danger",
      badgeLabel: "Critical",
    }));

  const openCaseItems = openCases.slice(0, 5).map<AttentionItem>((row) => ({
    id: row.id,
    title: row.subject?.trim() || `Case ${row.id.slice(0, 8)}`,
    detail: `${formatPriority(row.priority)} priority`,
    meta: `Updated ${formatDateTime(row.last_activity_at)}`,
    href: `/ops/cases/${row.id}`,
    tone:
      ["high", "urgent"].includes(String(row.priority ?? "").toLowerCase()) ? "danger" : "warning",
    badgeLabel: ["high", "urgent"].includes(String(row.priority ?? "").toLowerCase())
      ? "Open alert"
      : "Open",
  }));

  const staleListings = readinessRows
    .filter((row) => {
      const createdAt = parseDate(row.listing.created_at);
      return createdAt ? Date.now() - createdAt.getTime() > 45 * 24 * 60 * 60 * 1000 : false;
    })
    .slice(0, 4)
    .map<AttentionItem>((row) => ({
      id: row.listing.id,
      title: getListingDisplayName(row.listing),
      detail: row.readiness.status === "search_ready" ? "Older live listing to monitor" : "Older draft or blocked listing",
      meta: `Created ${formatDateTime(row.listing.created_at)}`,
      href: `/ops/listings?q=${row.listing.id}`,
      tone: "info",
      badgeLabel: "Monitor",
    }));

  const lowInventoryItems =
    searchReadyListings.length < 5
      ? [
          {
            id: "inventory",
            title: "Search-ready supply is thin",
            detail: `${searchReadyListings.length} listings are currently search-ready.`,
            meta: "Monitor supply before guest demand ramps.",
            href: "/ops/listings",
            tone: "info" as const,
            badgeLabel: "Monitor",
          },
        ]
      : [];

  const attention: AttentionSection[] = [
    {
      key: "critical",
      title: "Critical",
      description: "Financial state mismatches and payout issues that need intervention first.",
      groups: [
        {
          key: "failed-payouts",
          title: "Failed payouts",
          description: "Hosts with payout failures or blocked releases.",
          href: "/ops/payouts?view=failed",
          empty: "No failed payouts.",
          items: failedPayouts,
        },
        {
          key: "booking-anomalies",
          title: "Paid or cancelled anomalies",
          description: "Bookings whose financial state does not line up cleanly.",
          href: "/ops/bookings?status=confirmed",
          empty: "No booking finance anomalies.",
          items: [...payoutAnomalies, ...cancelledFinanciallyActive].slice(0, 5),
        },
      ],
    },
    {
      key: "today",
      title: "Needs action today",
      description: "Queues and listing blockers most likely to affect beta operations today.",
      groups: [
        {
          key: "verification",
          title: "Pending verification",
          description: "Guests waiting for manual review.",
          href: "/ops/verification?status=pending",
          empty: "No pending verification requests.",
          items: pendingVerifications,
        },
        {
          key: "listings",
          title: "Listings not search ready",
          description: "Hosts still blocked from public search visibility.",
          href: "/ops/listings",
          empty: "All loaded listings are search-ready.",
          items: notSearchReady,
        },
        {
          key: "payments",
          title: "Bookings awaiting payment too long",
          description: "Older checkout sessions that may need support follow-up.",
          href: "/ops/bookings?status=awaiting_payment",
          empty: "No ageing payment sessions.",
          items: bookingsAwaitingTooLong,
        },
        {
          key: "cases",
          title: "Open support cases",
          description: casesUnavailable
            ? "Cases are unavailable until the missing schema migration is applied."
            : "Live support issues that need staff attention.",
          href: "/ops/cases",
          empty: casesUnavailable ? "Cases feature unavailable in this environment." : "No open support cases.",
          items: openCaseItems,
        },
      ],
    },
    {
      key: "monitoring",
      title: "Monitoring",
      description: "Lower-urgency supply health and stale inventory signals.",
      groups: [
        {
          key: "inventory",
          title: "Inventory watch",
          description: "Marketplace supply and stale listing monitoring.",
          href: "/ops/listings",
          empty: "No inventory watch items right now.",
          items: [...lowInventoryItems, ...staleListings].slice(0, 5),
        },
      ],
    },
  ];

  const activity: ActivityItem[] = [
    ...bookings.slice(0, 6).map((booking) => ({
      id: `booking-created-${booking.id}`,
      title: "Booking created",
      detail:
        listingMap.get(booking.listing_id ?? "")?.title?.trim() || `Booking ${booking.id.slice(0, 8)}`,
      meta: booking.status?.replace(/_/g, " ") || "Pending",
      href: `/ops/bookings/${booking.id}`,
      at: booking.created_at ?? "",
      tone: "info" as const,
    })),
    ...bookings
      .filter(
        (booking) =>
          isPaidFinalBookingStatus(booking.status) ||
          ["paid", "succeeded", "complete"].includes(String(booking.stripe_status ?? "").toLowerCase())
      )
      .slice(0, 6)
      .map((booking) => ({
        id: `booking-confirmed-${booking.id}`,
        title: "Booking confirmed",
        detail:
          listingMap.get(booking.listing_id ?? "")?.title?.trim() || `Booking ${booking.id.slice(0, 8)}`,
        meta: formatCurrency(getCurrencyPence(booking), booking.currency ?? "GBP"),
        href: `/ops/bookings/${booking.id}`,
        at: booking.created_at ?? "",
        tone: "success" as const,
      })),
    ...listings.slice(0, 6).map((listing) => ({
      id: `listing-published-${listing.id}`,
      title: "Listing published",
      detail: getListingDisplayName(listing),
      meta: listing.location ?? "Location pending",
      href: `/ops/listings?q=${listing.id}`,
      at: listing.created_at ?? "",
      tone: "info" as const,
    })),
    ...hostProfiles
      .filter(
        (profile) =>
          Boolean(profile.stripe_account_id) &&
          String(profile.stripe_onboarding_status ?? "").toLowerCase() === "complete"
      )
      .slice(0, 6)
      .map((profile) => ({
        id: `stripe-${profile.id}`,
        title: "Host connected Stripe",
        detail: getProfileName(profile),
        meta: "Payouts ready",
        href: "/ops/users",
        at: profile.updated_at ?? profile.created_at ?? "",
        tone: "success" as const,
      })),
    ...verifications
      .filter((row) => String(row.status ?? "").toLowerCase() === "approved")
      .slice(0, 6)
      .map((row) => ({
        id: `verification-${row.user_id}`,
        title: "Verification approved",
        detail: `Guest ${row.user_id.slice(0, 8)}`,
        meta: "Guest cleared for booking flow",
        href: `/ops/verification/${row.user_id}`,
        at: row.reviewed_at ?? row.created_at ?? "",
        tone: "success" as const,
      })),
  ]
    .filter((item) => parseDate(item.at))
    .sort((a, b) => (parseDate(b.at)?.getTime() ?? 0) - (parseDate(a.at)?.getTime() ?? 0))
    .slice(0, 10);

  const payoutIssueCount =
    failedPayouts.length + payoutAnomalies.length + cancelledFinanciallyActive.length;
  const criticalAlertCount = payoutIssueCount;
  const todayAlertCount =
    pendingVerificationRows.length + listingsNeedingAction.length + bookingsAwaitingTooLong.length + openCases.length;

  const marketplaceStatus =
    criticalAlertCount > 0
      ? {
          label: "Critical",
          tone: "danger" as const,
          detail: `${criticalAlertCount} financial or payout alerts need intervention.`,
        }
      : todayAlertCount > 0
        ? {
            label: "Attention required",
            tone: "warning" as const,
            detail: `${todayAlertCount} items need action today across verification, listings, or support.`,
          }
        : {
            label: "Healthy",
            tone: "success" as const,
            detail: "No critical payment alerts and operational queues are clear.",
          };

  const metrics: MetricCard[] = [
    {
      label: "Marketplace status",
      value: marketplaceStatus.label,
      detail: marketplaceStatus.detail,
      href: "/ops/dashboard",
      tone: marketplaceStatus.tone,
      statusLabel: marketplaceStatus.label,
      dominant: true,
    },
    {
      label: "Revenue 30d",
      value: formatCurrency(revenue30dPence),
      detail: `${paidBookings30d.length} paid or confirmed bookings in the last 30 days.`,
      href: "/ops/bookings?status=confirmed",
      tone: "success",
      statusLabel: paidBookings30d.length > 0 ? "Healthy" : undefined,
    },
    {
      label: "Bookings 30d",
      value: String(recentBookings30d.length),
      detail: "Recent booking creation volume across the marketplace.",
      href: "/ops/bookings",
      tone: recentBookings30d.length > 0 ? "info" : "default",
      statusLabel: recentBookings30d.length > 0 ? "Live" : undefined,
    },
    {
      label: "Search-ready listings",
      value: String(searchReadyListings.length),
      detail: `${listingsNeedingAction.length} listings still need host action.`,
      href: "/ops/listings",
      tone: searchReadyListings.length > 0 ? "success" : "warning",
      statusLabel: searchReadyListings.length > 0 ? "Healthy" : "Needs action",
    },
    {
      label: "Pending verification",
      value: String(pendingVerificationRows.length),
      detail: "Documents or guest checks waiting for review.",
      href: "/ops/verification?status=pending",
      tone: pendingVerificationRows.length > 0 ? "warning" : "default",
      statusLabel: pendingVerificationRows.length > 0 ? "Queue" : undefined,
    },
    {
      label: "Payout issues",
      value: String(payoutIssueCount),
      detail: "Failed payouts, payout anomalies, or cancelled financial mismatches.",
      href: "/ops/payouts",
      tone: payoutIssueCount > 0 ? "danger" : "success",
      statusLabel: payoutIssueCount > 0 ? "Critical" : "Healthy",
    },
  ];

  return {
    props: {
      staffRole: guard.staff.role,
      marketplaceStatus,
      metrics,
      attention,
      activity,
      errors,
    },
  };
};

export default function OpsDashboard({
  staffRole,
  marketplaceStatus,
  metrics,
  attention,
  activity,
  errors,
}: PageProps) {
  const safeMarketplaceStatus = marketplaceStatus ?? {
    label: "Unknown",
    tone: "default" as const,
    detail: "Marketplace status could not be calculated.",
  };
  const safeMetrics = metrics?.length
    ? metrics
    : [
        {
          label: "Marketplace status",
          value: safeMarketplaceStatus.label,
          detail: safeMarketplaceStatus.detail,
          href: "/ops/dashboard",
          tone: safeMarketplaceStatus.tone,
          statusLabel: safeMarketplaceStatus.label,
          dominant: true,
        },
      ];
  const safeAttention = attention ?? [];
  const safeActivity = activity ?? [];
  const safeErrors = errors ?? [];

  return (
    <OpsLayout title="Overview" role={staffRole}>
      <div className="space-y-6">
        <OpsPageHeader
          title="Ops Control Tower"
          description="Staff operations"
          actions={
            <form method="get" action="/ops/bookings">
              <OpsSearchBar
                placeholder="Search booking, guest, host, listing or Stripe ID..."
                buttonLabel="Search"
              />
            </form>
          }
        />

        <OpsErrorPanel messages={safeErrors} />

        <section className="flex flex-wrap gap-3">
          {safeMetrics.map((metric) => (
            <OpsMetric
              key={metric.label}
              label={metric.label}
              value={metric.value}
              detail={metric.detail}
              href={metric.href}
              tone={metric.tone}
              statusLabel={metric.statusLabel}
              dominant={metric.dominant}
            />
          ))}
        </section>

        <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
          <div className="space-y-5">
            {safeAttention.map((section) => {
              const safeGroups = section.groups ?? [];
              return (
              <OpsSection
                key={section.key}
                title={section.title}
                description={section.description}
                compact
              >
                <div className="space-y-4">
                  {safeGroups.map((group) => {
                    const safeItems = group.items ?? [];
                    return (
                    <div key={group.key} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
                          <p className="mt-0.5 text-sm text-slate-600">{group.description}</p>
                        </div>
                        <Link
                          href={group.href}
                          className="text-xs font-medium text-slate-500 transition hover:text-slate-900"
                        >
                          View queue
                        </Link>
                      </div>

                      <div className="space-y-2">
                        {safeItems.length === 0 ? (
                          <OpsEmptyState title={group.empty} />
                        ) : (
                          safeItems.map((item) => (
                            <OpsAlertRow
                              key={`${group.key}-${item.id}`}
                              title={item.title}
                              detail={item.detail}
                              meta={item.meta}
                              href={item.href}
                              tone={item.tone}
                              badgeLabel={item.badgeLabel}
                            />
                          ))
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </OpsSection>
              );
            })}
          </div>

          <OpsSection
            title="Recent activity"
            description="Latest booking, listing, payout, and verification movement."
            compact
          >
            {safeActivity.length === 0 ? (
              <OpsEmptyState title="No recent activity yet." />
            ) : (
              <div className="space-y-3">
                {safeActivity.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="block rounded-xl border border-transparent px-1 py-1 transition hover:border-slate-200 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-500">{formatDateTime(item.at)}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
                      </div>
                      {item.meta ? (
                        <div className="shrink-0 pt-5 text-xs text-slate-500">{item.meta}</div>
                      ) : null}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </OpsSection>
        </div>
      </div>
    </OpsLayout>
  );
}
