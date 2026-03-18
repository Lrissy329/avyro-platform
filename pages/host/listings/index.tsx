import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { HostPageHeader } from "@/components/host/HostPageHeader";

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
    let isMounted = true;

    const loadListings = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: userData } = await supabase.auth.getUser();
        const fallbackSession = await supabase.auth.getSession();
        const userId = userData.user?.id ?? fallbackSession.data.session?.user?.id ?? null;

        if (!userId) {
          if (!isMounted) return;
          setLoading(false);
          router.replace("/login?redirect=%2Fhost%2Flistings");
          return;
        }

        const { data, error: fetchError } = await supabase
          .from("listings")
          .select(
            "id, title, location, booking_unit, rental_type, price_per_night, price_per_hour, created_at"
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (!isMounted) return;
        if (fetchError) {
          setError(fetchError.message);
          setListings([]);
        } else {
          setListings((data as ListingSummary[]) ?? []);
        }
      } catch (error: any) {
        if (!isMounted) return;
        setError(error?.message ?? "Failed to load listings.");
        setListings([]);
      }

      if (isMounted) setLoading(false);
    };

    loadListings();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const listingCount = useMemo(() => listings.length, [listings.length]);

  return (
    <HostShellLayout title="Listings" activeNav="listings">
      <div className="space-y-8">
        <HostPageHeader
          title="Listings"
          description="Manage availability, pricing, and listing details in one place."
          actions={
            <Button
              asChild
              className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
            >
              <Link href="/host/create-listing">New listing</Link>
            </Button>
          }
        />

        <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
            <p className="text-xs uppercase tracking-wider text-slate-500">
              {listingCount} listing{listingCount === 1 ? "" : "s"}
            </p>
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs uppercase tracking-wider text-slate-500">
                <span>Listing</span>
                <span>Type</span>
                <span>Price</span>
                <span>Actions</span>
              </div>
              {listings.map((listing) => {
                const unit = listing.booking_unit === "hourly" ? "hourly" : "nightly";
                const price = unit === "hourly" ? listing.price_per_hour : listing.price_per_night;
                return (
                  <div
                    key={listing.id}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 border-b border-slate-100 px-4 py-3 text-sm hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {listing.title ?? "Untitled listing"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {listing.location ?? "Location not set"}
                      </p>
                    </div>
                    <div className="text-sm text-slate-600">
                      {unit === "hourly" ? "Hourly" : "Nightly"} · {formatLabel(listing.rental_type)}
                    </div>
                    <div className="text-sm text-slate-600 font-mono tabular-nums">
                      {formatPrice(price ?? null, unit)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        asChild
                        size="sm"
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                      >
                        <Link href={`/listing/${listing.id}`}>View</Link>
                      </Button>
                      <Button
                        asChild
                        size="sm"
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                      >
                        <Link href={`/listing/${listing.id}/edit`}>Edit</Link>
                      </Button>
                      <Button
                        asChild
                        size="sm"
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                      >
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
      </div>
    </HostShellLayout>
  );
}
