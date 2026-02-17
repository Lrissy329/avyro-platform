// pages/host/dashboard.tsx
import { useEffect, useState } from "react";
import Link from "next/link";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/ensureProfile";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const earningsData = [
  { month: "Jan", earnings: 420, expected: 350 },
  { month: "Feb", earnings: 520, expected: 380 },
  { month: "Mar", earnings: 610, expected: 400 },
  { month: "Apr", earnings: 720, expected: 450 },
  { month: "May", earnings: 680, expected: 470 },
  { month: "Jun", earnings: 820, expected: 500 },
];

export default function HostDashboardPage() {
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
    }>
  >([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);

  useEffect(() => {
    const loadListings = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        setListingsLoading(false);
        return;
      }

      await ensureProfile();

      const { data, error } = await supabase
        .from("listings")
        .select("id, title, booking_unit, price_per_night")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(6);

      if (error) {
        setListingsError(error.message);
      } else {
        setListings(data ?? []);
      }

      setListingsLoading(false);
    };

    loadListings();
  }, []);

  return (
    <HostShellLayout title="Dashboard" activeNav="dashboard">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="col-span-2 flex flex-col justify-between rounded-2xl border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-5 py-4 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                Total earnings
              </p>
              <p className="mt-2 text-3xl font-semibold">
                £{totalEarnings.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
              </p>
            </div>
            <Badge className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
              +18.3% vs last month
            </Badge>
          </div>
          <p className="mt-3 text-xs text-slate-300">
            Combined income from Direct, Airbnb, Vrbo and other channels.
          </p>
        </Card>

        <Card className="rounded-2xl border-slate-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            This month&apos;s occupancy
          </p>
          <p className="mt-3 text-2xl font-semibold text-slate-900">
            {(occupancyThisMonth * 100).toFixed(0)}%
          </p>
          <p className="mt-1 text-xs text-slate-500">+6% vs last month</p>
        </Card>

        <Card className="rounded-2xl border-slate-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Upcoming check-ins
          </p>
          <p className="mt-3 text-2xl font-semibold text-slate-900">
            {upcomingCheckIns}
          </p>
          <p className="mt-1 text-xs text-slate-500">Next 7 days</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="rounded-2xl border-slate-200 px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Portfolio returns
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                244.7%
                <span className="ml-2 align-middle text-sm font-normal text-slate-500">
                  lifetime yield
                </span>
              </p>
            </div>
            <button className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Last 6 months
            </button>
          </div>

          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={earningsData}>
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#4B5563" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#4B5563" }}
                  tickFormatter={(v) => `£${v}`}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    borderColor: "rgba(11, 13, 16, 0.12)",
                    fontSize: 12,
                  }}
                  formatter={(value: any) => [`£${value}`, "Earnings"]}
                />
                <Line
                  type="monotone"
                  dataKey="earnings"
                  stroke="#0B0D10"
                  strokeWidth={2.4}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="expected"
                  stroke="#4B5563"
                  strokeWidth={1.6}
                  dot={false}
                  strokeDasharray="4 4"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="flex flex-col justify-between rounded-2xl border-slate-200 bg-slate-900 px-5 py-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Payout accounts
          </p>
          <div className="mt-4 rounded-2xl bg-slate-800 px-4 py-5 shadow-lg">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Primary account
            </p>
            <p className="mt-3 text-xl font-semibold font-mono tabular-nums">Lloyds •••• 0021</p>
            <p className="mt-2 text-xs text-slate-300">
              Last payout: <span className="font-mono tabular-nums">£320.00</span> · 27 Nov
            </p>
          </div>
          <div className="mt-4 text-[11px] text-slate-300">
            Manage payout destinations and see upcoming transfers.
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card className="rounded-2xl border-slate-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Net this month
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-900 font-mono tabular-nums">
            £1,347.09
          </p>
          <p className="mt-1 text-xs text-slate-500">
            After Avyro and processing fees.
          </p>
        </Card>
        <Card className="rounded-2xl border-slate-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Active listings
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-900 font-mono tabular-nums">3</p>
          <p className="mt-1 text-xs text-slate-500">
            Visible to crew across channels.
          </p>
        </Card>
        <Card className="rounded-2xl border-slate-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Pending actions
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-900 font-mono tabular-nums">
            {pendingActions}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Awaiting payment or approval.
          </p>
        </Card>
      </div>

      <div className="mt-6">
        <Card className="rounded-2xl border-slate-200 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Pricing
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Update base rates without touching the calendar.
              </p>
            </div>
            <Link
              href="/host/create-listing"
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
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
                    <span className="ml-3 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
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
    </HostShellLayout>
  );
}
