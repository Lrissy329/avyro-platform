import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HostPageHeader } from "@/components/host/HostPageHeader";
import { supabase } from "@/lib/supabaseClient";

type ListingPricing = {
  id: string;
  title: string | null;
  booking_unit: "nightly" | "hourly" | null;
  price_per_night: number | null;
  price_per_hour: number | null;
  user_id: string | null;
};

export default function ListingPricingPage() {
  const router = useRouter();
  const { id } = router.query as { id?: string };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [listing, setListing] = useState<ListingPricing | null>(null);
  const [basePrice, setBasePrice] = useState<string>("");

  useEffect(() => {
    const loadListing = async () => {
      if (!id) return;
      setLoading(true);
      setError(null);
      setSuccess(null);

      const { data: userData } = await supabase.auth.getUser();
      const fallbackSession = await supabase.auth.getSession();
      const user = userData.user ?? fallbackSession.data.session?.user ?? null;
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("listings")
        .select("id, title, booking_unit, price_per_night, price_per_hour, user_id")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const normalized: ListingPricing = {
        id: data.id,
        title: data.title ?? null,
        booking_unit: data.booking_unit ?? null,
        price_per_night: data.price_per_night ?? null,
        price_per_hour: data.price_per_hour ?? null,
        user_id: data.user_id ?? null,
      };

      setListing(normalized);
      const baseValue =
        normalized.booking_unit === "hourly"
          ? normalized.price_per_hour
          : normalized.price_per_night;
      setBasePrice(baseValue != null ? String(baseValue) : "");
      setLoading(false);
    };

    loadListing();
  }, [id, router]);

  const bookingUnit = listing?.booking_unit ?? "nightly";
  const unitLabel = bookingUnit === "hourly" ? "hour" : "night";
  const priceLabel = bookingUnit === "hourly" ? "Price per hour" : "Price per night";
  const helperCopy = useMemo(() => {
    if (bookingUnit === "hourly") {
      return "Hourly listings charge per hour. Day-use bookings are fixed to 6 hours.";
    }
    return "Nightly listings charge per night. Minimum stay is one night.";
  }, [bookingUnit]);

  const handleSave = async () => {
    if (!listing) return;
    setError(null);
    setSuccess(null);

    const value = Number(basePrice);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a base price greater than 0.");
      return;
    }

    setSaving(true);
    const updatePayload =
      bookingUnit === "hourly"
        ? { price_per_hour: value }
        : { price_per_night: value };
    const { error: updateError } = await supabase
      .from("listings")
      .update(updatePayload)
      .eq("id", listing.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setSuccess("Base price updated.");
    setSaving(false);
  };

  return (
    <HostShellLayout title="Pricing">
      <div className="space-y-8">
        <HostPageHeader
          title="Listing pricing"
          description="Set the base rate for this listing. Calendar pricing controls are locked."
          actions={
            id ? (
              <Link
                href={`/listing/${id}`}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
              >
                View listing
              </Link>
            ) : null
          }
        />

        <div className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {loading ? (
            <p className="text-sm text-slate-500">Loading pricing…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : listing ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">Listing</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {listing.title ?? "Untitled listing"}
                  </p>
                </div>
                <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {bookingUnit === "hourly" ? "Hourly" : "Nightly"}
                </span>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                {helperCopy}
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Commission</p>
                <p className="mt-1">12% (drops to 10% after 7 nights, 8% after 28 nights)</p>
                <p>£150 maximum per booking</p>
                <p>First completed booking will be commission-free (processing fees still apply).</p>
              </div>

              <div>
                <Label htmlFor="base-price">{priceLabel}</Label>
                <div className="mt-2 flex items-center gap-3">
                  <Input
                    id="base-price"
                    type="number"
                    min="1"
                    step="1"
                    value={basePrice}
                    onChange={(event) => setBasePrice(event.target.value)}
                    className="max-w-[180px]"
                  />
                  <span className="text-sm text-slate-500">per {unitLabel}</span>
                </div>
              </div>

              {success && <p className="text-sm text-emerald-600">{success}</p>}
              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex items-center gap-3">
                <button
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save price"}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
                  onClick={() =>
                    setBasePrice(
                      bookingUnit === "hourly"
                        ? listing.price_per_hour != null
                          ? String(listing.price_per_hour)
                          : ""
                        : listing.price_per_night != null
                        ? String(listing.price_per_night)
                        : ""
                    )
                  }
                >
                  Reset
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Listing not found.</p>
          )}
        </div>
      </div>
    </HostShellLayout>
  );
}
