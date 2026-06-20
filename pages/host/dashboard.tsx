import { useState } from "react";
import type { GetServerSideProps } from "next";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { HostPageHeader } from "@/components/host/HostPageHeader";
import { isPaidFinalBookingStatus } from "@/lib/bookingStatus";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

const HostEarningsChart = dynamic(
  () => import("@/components/host/HostEarningsChart").then((mod) => mod.HostEarningsChart),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-slate-100" />,
  }
);

type ListingRow = {
  id: string;
  title: string | null;
  booking_unit: "nightly" | "hourly" | null;
  price_per_night: number | null;
  is_shared_stay: boolean | null;
  created_at: string | null;
};

type BookingRow = {
  id: string;
  listing_id: string | null;
  status: string | null;
  payout_status?: string | null;
  payout_released_at?: string | null;
  payout_transfer_id?: string | null;
  host_net_total_pence?: number | null;
  guest_total_pence?: number | null;
  price_total?: number | null;
  currency?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  created_at?: string | null;
};

type EarningsDatum = {
  month: string;
  earnings: number;
  expected: number;
};

type StripeSnapshot = {
  accountId: string | null;
  onboardingStatus: string | null;
};

type SummaryMetrics = {
  totalBookedRevenuePence: number;
  bookedThisMonthPence: number;
  currentMonthBookedDeltaPct: number | null;
  occupancyThisMonth: number | null;
  occupancyDeltaPct: number | null;
  upcomingCheckIns: number;
  activeListings: number;
  pendingActions: number;
  awaitingPayoutCount: number;
  awaitingPayoutPence: number;
  releasedPayoutCount: number;
  lastPayoutAmountPence: number | null;
  lastPayoutDate: string | null;
};

type UpcomingStay = {
  id: string;
  listingTitle: string;
  checkIn: string | null;
  checkOut: string | null;
  hostNetPence: number;
  status: string | null;
};

type PageProps = {
  listings: ListingRow[];
  summary: SummaryMetrics;
  earningsData: EarningsDatum[];
  stripe: StripeSnapshot;
  upcomingStays: UpcomingStay[];
};

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

const parseDateValue = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const getBookingStart = (booking: BookingRow) =>
  parseDateValue(booking.check_in_time ?? booking.check_in ?? null);

const getBookingEnd = (booking: BookingRow) =>
  parseDateValue(booking.check_out_time ?? booking.check_out ?? null);

const getHostNetPence = (booking: BookingRow) => {
  const hostNet = Number(booking.host_net_total_pence ?? NaN);
  if (Number.isFinite(hostNet) && hostNet > 0) return Math.round(hostNet);

  const guestTotal = Number(booking.guest_total_pence ?? NaN);
  if (Number.isFinite(guestTotal) && guestTotal > 0) return Math.round(guestTotal);

  const totalMajor = Number(booking.price_total ?? NaN);
  if (Number.isFinite(totalMajor) && totalMajor > 0) return Math.round(totalMajor * 100);

  return 0;
};

const formatCurrencyFromPence = (amountPence?: number | null, currency = "GBP") => {
  if (amountPence == null || !Number.isFinite(amountPence)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountPence / 100);
};

const formatCurrencyCompact = (amountPence?: number | null, currency = "GBP") => {
  if (amountPence == null || !Number.isFinite(amountPence)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: amountPence % 100 === 0 ? 0 : 2,
  }).format(amountPence / 100);
};

const formatDate = (value?: string | null) => {
  const date = parseDateValue(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const formatDateLong = (value?: string | null) => {
  const date = parseDateValue(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthEnd = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);
const shiftMonth = (date: Date, offset: number) => new Date(date.getFullYear(), date.getMonth() + offset, 1);

const diffDays = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));

const overlapNights = (start: Date | null, end: Date | null, rangeStart: Date, rangeEnd: Date) => {
  if (!start || !end) return 0;
  const overlapStart = start > rangeStart ? start : rangeStart;
  const overlapEnd = end < rangeEnd ? end : rangeEnd;
  return overlapEnd > overlapStart ? diffDays(overlapStart, overlapEnd) : 0;
};

const buildDeltaLabel = (delta: number | null, positivePrefix = "+") => {
  if (delta == null) return "Live data";
  if (delta === 0) return "Flat vs last month";
  const prefix = delta > 0 ? positivePrefix : "";
  return `${prefix}${delta.toFixed(0)}% vs last month`;
};

const trimStripeAccountId = (accountId?: string | null) => {
  if (!accountId) return "Connect Stripe to receive payouts.";
  if (accountId.length <= 12) return accountId;
  return `${accountId.slice(0, 8)}…${accountId.slice(-4)}`;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const authClient = createPagesServerClient(ctx);
  const {
    data: { session },
    error: sessionError,
  } = await authClient.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return {
      redirect: {
        destination: `/login?redirect=${encodeURIComponent(ctx.resolvedUrl)}`,
        permanent: false,
      },
    };
  }

  const userId = session.user.id;
  const admin = getSupabaseServerClient();

  const listingSelects = [
    "id, title, booking_unit, price_per_night, is_shared_stay, created_at",
    "id, title, booking_unit, price_per_night, created_at",
    "id, title, price_per_night, created_at",
  ];

  let listings: ListingRow[] = [];
  let listingsError: any = null;
  for (const select of listingSelects) {
    const result = await admin
      .from("listings")
      .select(select)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    listings = (result.data as unknown as ListingRow[]) ?? [];
    listingsError = result.error;
    if (!listingsError) break;
    if (!isMissingColumn(listingsError)) break;
  }

  if (listingsError) {
    console.error("[host dashboard] failed to load listings", listingsError.message);
    listings = [];
  }

  const bookingSelects = [
    "id, listing_id, status, payout_status, payout_released_at, payout_transfer_id, host_net_total_pence, guest_total_pence, price_total, currency, check_in_time, check_out_time, check_in, check_out, created_at",
    "id, listing_id, status, payout_status, payout_released_at, payout_transfer_id, host_net_total_pence, price_total, currency, check_in_time, check_out_time, check_in, check_out, created_at",
    "id, listing_id, status, payout_status, payout_released_at, payout_transfer_id, price_total, currency, check_in_time, check_out_time, check_in, check_out, created_at",
  ];

  let bookings: BookingRow[] = [];
  let bookingsError: any = null;
  for (const select of bookingSelects) {
    const result = await admin
      .from("bookings")
      .select(select)
      .eq("host_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);

    bookings = (result.data as unknown as BookingRow[]) ?? [];
    bookingsError = result.error;
    if (!bookingsError) break;
    if (!isMissingColumn(bookingsError)) break;
  }

  if (bookingsError) {
    console.error("[host dashboard] failed to load bookings", bookingsError.message);
    bookings = [];
  }

  const { data: profileRow, error: profileError } = await admin
    .from("profiles")
    .select("stripe_account_id, stripe_onboarding_status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("[host dashboard] failed to load stripe profile", profileError.message);
  }

  const now = new Date();
  const currentMonthStart = monthStart(now);
  const nextMonthStart = monthEnd(now);
  const previousMonthStart = shiftMonth(now, -1);
  const previousMonthEnd = monthStart(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextWeekEnd = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 7);

  const listingTitleById = listings.reduce<Record<string, string>>((acc, listing) => {
    acc[listing.id] = listing.title ?? "Untitled listing";
    return acc;
  }, {});

  const finalBookings = bookings.filter((booking) => isPaidFinalBookingStatus(booking.status));
  const pendingBookingStatuses = new Set(["awaiting_payment", "pending_payment", "approved", "payment_failed"]);
  const pendingBookings = bookings.filter((booking) =>
    pendingBookingStatuses.has(String(booking.status ?? "").toLowerCase())
  );
  const payoutFailures = bookings.filter(
    (booking) => String(booking.payout_status ?? "").toLowerCase() === "failed"
  );

  const totalBookedRevenuePence = finalBookings.reduce(
    (sum, booking) => sum + getHostNetPence(booking),
    0
  );

  const bookedThisMonthPence = finalBookings.reduce((sum, booking) => {
    const createdAt = parseDateValue(booking.created_at ?? null);
    if (!createdAt || createdAt < currentMonthStart || createdAt >= nextMonthStart) return sum;
    return sum + getHostNetPence(booking);
  }, 0);

  const bookedLastMonthPence = finalBookings.reduce((sum, booking) => {
    const createdAt = parseDateValue(booking.created_at ?? null);
    if (!createdAt || createdAt < previousMonthStart || createdAt >= previousMonthEnd) return sum;
    return sum + getHostNetPence(booking);
  }, 0);

  const currentMonthBookedDeltaPct =
    bookedLastMonthPence > 0
      ? ((bookedThisMonthPence - bookedLastMonthPence) / bookedLastMonthPence) * 100
      : bookedThisMonthPence > 0
      ? 100
      : null;

  const nightlyListingIds = new Set(
    listings.filter((listing) => listing.booking_unit !== "hourly").map((listing) => listing.id)
  );
  const nightlyListingCount = nightlyListingIds.size;
  const thisMonthBookedNights = finalBookings.reduce((sum, booking) => {
    if (!booking.listing_id || !nightlyListingIds.has(booking.listing_id)) return sum;
    return sum + overlapNights(getBookingStart(booking), getBookingEnd(booking), currentMonthStart, nextMonthStart);
  }, 0);
  const previousMonthBookedNights = finalBookings.reduce((sum, booking) => {
    if (!booking.listing_id || !nightlyListingIds.has(booking.listing_id)) return sum;
    return sum + overlapNights(getBookingStart(booking), getBookingEnd(booking), previousMonthStart, previousMonthEnd);
  }, 0);

  const currentMonthInventory = nightlyListingCount * diffDays(currentMonthStart, nextMonthStart);
  const previousMonthInventory = nightlyListingCount * diffDays(previousMonthStart, previousMonthEnd);
  const occupancyThisMonth =
    currentMonthInventory > 0 ? thisMonthBookedNights / currentMonthInventory : null;
  const occupancyLastMonth =
    previousMonthInventory > 0 ? previousMonthBookedNights / previousMonthInventory : null;
  const occupancyDeltaPct =
    occupancyThisMonth != null && occupancyLastMonth != null && occupancyLastMonth > 0
      ? ((occupancyThisMonth - occupancyLastMonth) / occupancyLastMonth) * 100
      : occupancyThisMonth != null && occupancyThisMonth > 0
      ? 100
      : null;

  const upcomingCheckInBookings = finalBookings
    .filter((booking) => {
      const checkIn = getBookingStart(booking);
      return checkIn != null && checkIn >= todayStart && checkIn < nextWeekEnd;
    })
    .sort((a, b) => {
      const aTime = getBookingStart(a)?.getTime() ?? 0;
      const bTime = getBookingStart(b)?.getTime() ?? 0;
      return aTime - bTime;
    });

  const upcomingStays = upcomingCheckInBookings
    .slice(0, 4)
    .map((booking) => ({
      id: booking.id,
      listingTitle: booking.listing_id ? listingTitleById[booking.listing_id] ?? "Untitled listing" : "Untitled listing",
      checkIn: booking.check_in_time ?? booking.check_in ?? null,
      checkOut: booking.check_out_time ?? booking.check_out ?? null,
      hostNetPence: getHostNetPence(booking),
      status: booking.status ?? null,
    }));

  const awaitingPayoutRows = finalBookings.filter((booking) => {
    const payoutStatus = String(booking.payout_status ?? "").toLowerCase();
    return payoutStatus === "awaiting_payout" || payoutStatus === "scheduled" || payoutStatus === "";
  });
  const awaitingPayoutPence = awaitingPayoutRows.reduce(
    (sum, booking) => sum + getHostNetPence(booking),
    0
  );

  const releasedPayouts = finalBookings
    .filter(
      (booking) =>
        String(booking.payout_status ?? "").toLowerCase() === "paid" &&
        parseDateValue(booking.payout_released_at ?? null)
    )
    .sort((a, b) => {
      const aTime = parseDateValue(a.payout_released_at ?? null)?.getTime() ?? 0;
      const bTime = parseDateValue(b.payout_released_at ?? null)?.getTime() ?? 0;
      return bTime - aTime;
    });

  const lastPayout = releasedPayouts[0] ?? null;

  const monthBuckets = Array.from({ length: 6 }, (_, index) => shiftMonth(now, index - 5)).map(
    (date) => ({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      month: date.toLocaleDateString("en-GB", { month: "short" }),
      rangeStart: monthStart(date),
      rangeEnd: monthEnd(date),
    })
  );

  const earningsData = monthBuckets.map((bucket) => {
    const earnings = finalBookings.reduce((sum, booking) => {
      const createdAt = parseDateValue(booking.created_at ?? null);
      if (!createdAt || createdAt < bucket.rangeStart || createdAt >= bucket.rangeEnd) return sum;
      return sum + getHostNetPence(booking) / 100;
    }, 0);

    const expected = bookings.reduce((sum, booking) => {
      const createdAt = parseDateValue(booking.created_at ?? null);
      const status = String(booking.status ?? "").toLowerCase();
      if (!createdAt || createdAt < bucket.rangeStart || createdAt >= bucket.rangeEnd) return sum;
      if (!pendingBookingStatuses.has(status)) return sum;
      return sum + getHostNetPence(booking) / 100;
    }, 0);

    return {
      month: bucket.month,
      earnings: Math.round(earnings),
      expected: Math.round(expected),
    };
  });

  const summary: SummaryMetrics = {
    totalBookedRevenuePence,
    bookedThisMonthPence,
    currentMonthBookedDeltaPct,
    occupancyThisMonth,
    occupancyDeltaPct,
    upcomingCheckIns: upcomingCheckInBookings.length,
    activeListings: listings.length,
    pendingActions:
      pendingBookings.length +
      payoutFailures.length +
      (profileRow?.stripe_account_id && profileRow?.stripe_onboarding_status !== "complete" ? 1 : 0),
    awaitingPayoutCount: awaitingPayoutRows.length,
    awaitingPayoutPence,
    releasedPayoutCount: releasedPayouts.length,
    lastPayoutAmountPence: lastPayout ? getHostNetPence(lastPayout) : null,
    lastPayoutDate: lastPayout?.payout_released_at ?? null,
  };

  return {
    props: {
      listings,
      summary,
      earningsData,
      stripe: {
        accountId: (profileRow as any)?.stripe_account_id ?? null,
        onboardingStatus: (profileRow as any)?.stripe_onboarding_status ?? null,
      },
      upcomingStays,
    },
  };
};

export default function HostDashboardPage({
  listings,
  summary,
  earningsData,
  stripe,
  upcomingStays,
}: PageProps) {
  const [showSharedStayGuide, setShowSharedStayGuide] = useState(false);

  const sharedListings = listings.filter((listing) => Boolean(listing.is_shared_stay));
  const newestSharedListing = sharedListings[0] ?? null;
  const newestSharedCreatedAt = newestSharedListing?.created_at
    ? new Date(newestSharedListing.created_at).getTime()
    : null;
  const shouldShowSharedConfidenceCard =
    sharedListings.length === 0 ||
    (sharedListings.length === 1 &&
      newestSharedCreatedAt != null &&
      Date.now() - newestSharedCreatedAt <= 14 * 24 * 60 * 60 * 1000);

  const stripeConnected = stripe.onboardingStatus === "complete";
  const stripeLabel = stripeConnected
    ? "Connected"
    : stripe.accountId
    ? "Setup incomplete"
    : "Not connected";
  const stripeBadgeClass = stripeConnected
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : stripe.accountId
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : "border-slate-200 bg-slate-50 text-slate-500";

  return (
    <HostShellLayout title="Hosting insights" activeNav="dashboard">
      <div className="space-y-8">
        <HostPageHeader
          title="Hosting insights"
          description="Live view of bookings, occupancy, booked revenue and payout progress."
          actions={
            <>
              <Link
                href="/host/calendar"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
              >
                Open calendar
              </Link>
              <Link
                href="/host/payouts"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
              >
                View payouts
              </Link>
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="col-span-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Booked host revenue</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">
                  {formatCurrencyCompact(summary.totalBookedRevenuePence)}
                </p>
              </div>
              <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {buildDeltaLabel(summary.currentMonthBookedDeltaPct)}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Net booked revenue from confirmed and paid stays across your Flexivo listings.
            </p>
          </Card>

          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">This month&apos;s occupancy</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.occupancyThisMonth != null ? `${(summary.occupancyThisMonth * 100).toFixed(0)}%` : "—"}
            </p>
            <p className="mt-1 text-sm text-slate-600">{buildDeltaLabel(summary.occupancyDeltaPct)}</p>
          </Card>

          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Upcoming check-ins</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{summary.upcomingCheckIns}</p>
            <p className="mt-1 text-sm text-slate-600">Next 7 days</p>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Booking trend</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCurrencyCompact(summary.bookedThisMonthPence)}
                  <span className="ml-2 align-middle text-sm font-normal text-slate-500">
                    booked this month
                  </span>
                </p>
              </div>
              <span className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800">
                Last 6 months
              </span>
            </div>

            <div className="mt-4 h-56">
              <HostEarningsChart data={earningsData} />
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Solid line shows booked net revenue. Dotted line tracks bookings still in flight.
            </p>
          </Card>

          <div className="space-y-4">
            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500">Payout account</p>
                  <p className="mt-2 text-xl font-semibold text-slate-900">Stripe Express</p>
                </div>
                <Badge className={`rounded-full border px-3 py-1 text-xs font-semibold ${stripeBadgeClass}`}>
                  {stripeLabel}
                </Badge>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-5">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Account</p>
                <p className="mt-3 text-xl font-semibold text-slate-900 font-mono tabular-nums">
                  {trimStripeAccountId(stripe.accountId)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {summary.lastPayoutDate
                    ? `Last payout: ${formatCurrencyFromPence(summary.lastPayoutAmountPence)} · ${formatDate(summary.lastPayoutDate)}`
                    : summary.awaitingPayoutCount > 0
                    ? `${summary.awaitingPayoutCount} payout${summary.awaitingPayoutCount === 1 ? "" : "s"} waiting · ${formatCurrencyFromPence(summary.awaitingPayoutPence)}`
                    : "No payout activity yet."}
                </p>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                {stripeConnected
                  ? "Your connected Stripe account is ready for upcoming transfers."
                  : "Finish Stripe setup to keep payouts moving without delays."}
              </p>
            </Card>

            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500">Next arrivals</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Upcoming stays that need the space ready.
                  </p>
                </div>
                <Link
                  href="/host/guests"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 hover:bg-slate-50"
                >
                  View all
                </Link>
              </div>

              <div className="mt-4 space-y-3">
                {upcomingStays.length ? (
                  upcomingStays.map((stay) => (
                    <Link
                      key={stay.id}
                      href={`/host/bookings/${stay.id}`}
                      className="block rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{stay.listingTitle}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDateLong(stay.checkIn)}{stay.checkOut ? ` → ${formatDateLong(stay.checkOut)}` : ""}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-slate-900">
                          {formatCurrencyFromPence(stay.hostNetPence)}
                        </span>
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No confirmed check-ins in the next 7 days.</p>
                )}
              </div>
            </Card>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Booked this month</p>
            <p className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
              {formatCurrencyCompact(summary.bookedThisMonthPence)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              New booked net revenue created this month.
            </p>
          </Card>
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Active listings</p>
            <p className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
              {summary.activeListings}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Listings currently managed from your host account.
            </p>
          </Card>
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Pending actions</p>
            <p className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
              {summary.pendingActions}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Awaiting payment, payout follow-up, or Stripe setup tasks.
            </p>
          </Card>
        </div>

        {shouldShowSharedConfidenceCard ? (
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold text-slate-900">Shared Stay for airport professionals</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Shared Stay helps professionals coordinate accommodation near airports. The first
                  guest secures the stay, then other professionals can continue joining until the
                  available spots are filled.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSharedStayGuide((current) => !current)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                {showSharedStayGuide ? "Hide Shared Stay guide" : "Learn how Shared Stay works"}
              </button>
            </div>

            {showSharedStayGuide ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">How occupancy works</p>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                    <p>Professionals book individual spots in the property.</p>
                    <p>Joining an existing stay matters because it keeps demand concentrated in one live weekly stay.</p>
                    <p>Once a shared stay begins, the property dates are reserved for that stay while more professionals continue joining.</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">Why hosts use it</p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                    <li>Longer weekly stays can reduce vacancy gaps.</li>
                    <li>Pricing stays simple with one weekly property rate.</li>
                    <li>Designed for crew, trainees, contractors, and airport professionals.</li>
                    <li>Your stay is confirmed when the first guest secures the booking.</li>
                  </ul>
                </div>
              </div>
            ) : null}
          </Card>
        ) : null}

        <div>
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">Pricing</p>
                <p className="mt-1 text-sm text-slate-600">
                  Update base rates without touching the calendar.
                </p>
              </div>
              <Link
                href="/host/create-listing"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
              >
                New listing
              </Link>
            </div>

            <div className="mt-4">
              {listings.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {listings.slice(0, 6).map((listing) => (
                    <Link
                      key={listing.id}
                      href={`/host/listings/${listing.id}/pricing`}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <span className="truncate">{listing.title ?? "Untitled listing"}</span>
                      <span className="ml-3 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {listing.booking_unit === "hourly" ? "Hourly" : "Nightly"}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No listings yet. Create one to set pricing.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </HostShellLayout>
  );
}
