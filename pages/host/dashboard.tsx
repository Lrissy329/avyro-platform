// pages/host/dashboard.tsx
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/ensureProfile";
import { HostPageHeader } from "@/components/host/HostPageHeader";

const HostEarningsChart = dynamic(
  () => import("@/components/host/HostEarningsChart").then((mod) => mod.HostEarningsChart),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-slate-100" />,
  }
);

const earningsData = [
  { month: "Jan", earnings: 420, expected: 350 },
  { month: "Feb", earnings: 520, expected: 380 },
  { month: "Mar", earnings: 610, expected: 400 },
  { month: "Apr", earnings: 720, expected: 450 },
  { month: "May", earnings: 680, expected: 470 },
  { month: "Jun", earnings: 820, expected: 500 },
];

export default function HostDashboardPage() {
  const router = useRouter();
  const totalEarnings = 4747.09;
  const occupancyThisMonth = 0.78;
  const upcomingCheckIns = 12;
  const pendingActions = 3;
  const [listings, setListings] = useState<
    Array<{
      id: string;
      title: string | null;
      booking_unit: "nightly" | "hourly" | null;
      price_per_night: number | null;
      is_shared_stay: boolean | null;
      created_at: string | null;
    }>
  >([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [showSharedStayGuide, setShowSharedStayGuide] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadListings = async () => {
      setListingsLoading(true);
      setListingsError(null);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const fallbackSession = await supabase.auth.getSession();
        const userId = userData.user?.id ?? fallbackSession.data.session?.user?.id ?? null;

        if (!userId) {
          if (!isMounted) return;
          setListings([]);
          setListingsLoading(false);
          router.replace("/login?redirect=%2Fhost%2Fdashboard");
          return;
        }

        await ensureProfile();

        const { data, error } = await supabase
          .from("listings")
          .select("id, title, booking_unit, price_per_night, is_shared_stay, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(6);

        if (!isMounted) return;
        if (error) {
          setListingsError(error.message);
          setListings([]);
          return;
        }
        setListings(data ?? []);
      } catch (error: any) {
        if (!isMounted) return;
        setListings([]);
        setListingsError(error?.message ?? "Failed to load listings.");
      } finally {
        if (isMounted) setListingsLoading(false);
      }
    };

    loadListings();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const sharedListings = listings.filter((listing) => Boolean(listing.is_shared_stay));
  const newestSharedListing = sharedListings[0] ?? null;
  const newestSharedCreatedAt = newestSharedListing?.created_at
    ? new Date(newestSharedListing.created_at).getTime()
    : null;
  const shouldShowSharedConfidenceCard =
    !listingsLoading &&
    (sharedListings.length === 0 ||
      (sharedListings.length === 1 &&
        newestSharedCreatedAt != null &&
        Date.now() - newestSharedCreatedAt <= 14 * 24 * 60 * 60 * 1000));

  return (
    <HostShellLayout title="Hosting insights" activeNav="dashboard">
      <div className="space-y-8">
        <HostPageHeader
          title="Hosting insights"
          description="Snapshot of occupancy, earnings, and upcoming activity."
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="col-span-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Total earnings</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">
                  £{totalEarnings.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
                </p>
              </div>
              <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                +18.3% vs last month
              </Badge>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Combined income from Direct, Airbnb, Vrbo and other channels.
            </p>
          </Card>

          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">This month&apos;s occupancy</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {(occupancyThisMonth * 100).toFixed(0)}%
            </p>
            <p className="mt-1 text-sm text-slate-600">+6% vs last month</p>
          </Card>

          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Upcoming check-ins</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{upcomingCheckIns}</p>
            <p className="mt-1 text-sm text-slate-600">Next 7 days</p>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Portfolio returns</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  244.7%
                  <span className="ml-2 align-middle text-sm font-normal text-slate-500">
                    lifetime yield
                  </span>
                </p>
              </div>
              <button className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 hover:bg-slate-50">
                Last 6 months
              </button>
            </div>

            <div className="mt-4 h-56">
              <HostEarningsChart data={earningsData} />
            </div>
          </Card>

          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Payout accounts</p>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">
                Primary account
              </p>
              <p className="mt-3 text-xl font-semibold text-slate-900 font-mono tabular-nums">
                Lloyds •••• 0021
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Last payout: <span className="font-mono tabular-nums">£320.00</span> · 27 Nov
              </p>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Manage payout destinations and see upcoming transfers.
            </p>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Net this month</p>
            <p className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
              £1,347.09
            </p>
            <p className="mt-1 text-sm text-slate-600">
              After Veloro and processing fees.
            </p>
          </Card>
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Active listings</p>
            <p className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
              {listingsLoading ? "—" : listings.length}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Visible to crew across channels.
            </p>
          </Card>
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Pending actions</p>
            <p className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
              {pendingActions}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Awaiting payment or approval.
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
              {listingsLoading ? (
                <p className="text-sm text-slate-500">Loading listings…</p>
              ) : listingsError ? (
                <p className="text-sm text-red-600">{listingsError}</p>
              ) : listings.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {listings.map((listing) => (
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
