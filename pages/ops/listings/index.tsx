import type { GetServerSideProps } from "next";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

type ListingRow = {
  id: string;
  title: string | null;
  location: string | null;
  booking_unit: string | null;
  price_per_night: number | null;
  created_at: string | null;
};

type PageProps = {
  listings: ListingRow[];
  staffRole: OpsRole;
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:listings:read" });
  if ("redirect" in guard) return guard;

  const listingId = typeof ctx.query.listingId === "string" ? ctx.query.listingId.trim() : "";

  const admin = getSupabaseServerClient();
  let query = admin
    .from("listings")
    .select("id, title, location, booking_unit, price_per_night, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (listingId) {
    query = query.eq("id", listingId);
  }

  const { data } = await query;

  return {
    props: {
      listings: data ?? [],
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsListings({ listings, staffRole }: PageProps) {
  return (
    <OpsLayout title="Listings" role={staffRole}>
      <div className="overflow-hidden rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)]">
        <div className="grid grid-cols-[1.3fr_1fr_0.8fr_0.6fr_0.6fr] gap-3 border-b border-[var(--ops-border)] px-4 py-3 text-xs uppercase tracking-[0.28em] text-[var(--ops-muted)]">
          <span>Listing</span>
          <span>Location</span>
          <span>Unit</span>
          <span>Price</span>
          <span>Created</span>
        </div>
        <div className="divide-y divide-[var(--ops-border)]">
          {listings.length === 0 ? (
            <div className="px-4 py-8 text-sm text-[var(--ops-muted)]">No listings found.</div>
          ) : (
            listings.map((listing) => (
              <div
                key={listing.id}
                className="grid grid-cols-[1.3fr_1fr_0.8fr_0.6fr_0.6fr] gap-3 px-4 py-3 text-sm"
              >
                <div className="text-white">{listing.title ?? listing.id}</div>
                <div className="text-xs text-[var(--ops-muted)]">{listing.location ?? "—"}</div>
                <div className="text-xs text-[var(--ops-muted)]">{listing.booking_unit ?? "—"}</div>
                <div className="text-xs text-[var(--ops-muted)]">
                  {listing.price_per_night != null ? `GBP ${listing.price_per_night}` : "—"}
                </div>
                <div className="text-xs text-[var(--ops-muted)]">
                  {formatDate(listing.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </OpsLayout>
  );
}
