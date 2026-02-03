import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";

type ListingSummary = {
  id: string;
  title: string | null;
  location: string | null;
  booking_unit: "nightly" | "hourly" | null;
  rental_type: string | null;
  price_per_night: number | null;
  price_per_hour: number | null;
  created_at: string | null;
};

const formatLabel = (value: string | null | undefined) => {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

const formatPrice = (value: number | null, unit: "nightly" | "hourly") => {
  if (value == null || Number.isNaN(value)) return "No price set";
  const formatted = value.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  return `£${formatted} per ${unit === "hourly" ? "hour" : "night"}`;
};

export default function HostListingsPage() {
  const router = useRouter();
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadListings = async () => {
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("listings")
        .select(
          "id, title, location, booking_unit, rental_type, price_per_night, price_per_hour, created_at"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        setListings([]);
      } else {
        setListings((data as ListingSummary[]) ?? []);
      }

      setLoading(false);
    };

    loadListings();
  }, [router]);

  const listingCount = useMemo(() => listings.length, [listings.length]);

  return (
    <HostShellLayout title="Listings" activeNav="listings">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Your listings</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage availability, pricing, and listing details in one place.
          </p>
        </div>
        <Button asChild>
          <Link href="/host/create-listing">New listing</Link>
        </Button>
      </div>

      <Card className="rounded-2xl border-slate-200 px-6 py-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading listings…</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : listings.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">No listings yet.</p>
            <Link href="/host/create-listing" className="text-sm text-slate-900 underline">
              Create your first listing
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              {listingCount} listing{listingCount === 1 ? "" : "s"}
            </p>
            <div className="grid gap-4">
              {listings.map((listing) => {
                const unit = listing.booking_unit === "hourly" ? "hourly" : "nightly";
                const price =
                  unit === "hourly" ? listing.price_per_hour : listing.price_per_night;
                return (
                  <div
                    key={listing.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4"
                  >
                    <div className="min-w-[220px] flex-1">
                      <p className="text-sm font-semibold text-slate-900 font-display">
                        {listing.title ?? "Untitled listing"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {listing.location ?? "Location not set"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                          {unit === "hourly" ? "Hourly" : "Nightly"}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                          {formatLabel(listing.rental_type)}
                        </span>
                      </div>
                    </div>

                    <div className="min-w-[180px] text-sm text-slate-600 font-mono tabular-nums">
                      {formatPrice(price ?? null, unit)}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/listing/${listing.id}`}>View</Link>
                      </Button>
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/listing/${listing.id}/edit`}>Edit</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/host/listings/${listing.id}/pricing`}>Pricing</Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </HostShellLayout>
  );
}
