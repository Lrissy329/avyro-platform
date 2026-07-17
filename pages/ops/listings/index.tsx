import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsEmptyState from "@/components/ops/OpsEmptyState";
import OpsErrorPanel from "@/components/ops/OpsErrorPanel";
import OpsFilterBar from "@/components/ops/OpsFilterBar";
import OpsLayout from "@/components/ops/OpsLayout";
import OpsPageHeader from "@/components/ops/OpsPageHeader";
import OpsSearchBar from "@/components/ops/OpsSearchBar";
import OpsStatusBadge from "@/components/ops/OpsStatusBadge";
import OpsTable from "@/components/ops/OpsTable";
import { type ListingReadiness, evaluateListingReadiness } from "@/lib/listingReadiness";
import { requireOpsStaff } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

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
  created_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  stripe_account_id?: string | null;
  stripe_onboarding_status?: string | null;
};

type ListingWithReadiness = {
  listing: ListingRow;
  host: ProfileRow | null;
  readiness: ListingReadiness;
};

type PageProps = {
  listings: ListingWithReadiness[];
  staffRole: OpsRole;
  query: {
    q: string;
  };
  errors: string[];
};

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const formatListingPrice = (listing: ListingRow) => {
  if (listing.is_shared_stay && Number(listing.shared_weekly_price_pence ?? 0) > 0) {
    return `£${((listing.shared_weekly_price_pence ?? 0) / 100).toLocaleString("en-GB", {
      maximumFractionDigits: 0,
    })} / week`;
  }
  if (listing.booking_unit === "hourly" && Number(listing.price_per_hour ?? 0) > 0) {
    return `£${Number(listing.price_per_hour).toLocaleString("en-GB", {
      maximumFractionDigits: 0,
    })} / hour`;
  }
  if (Number(listing.price_per_night ?? 0) > 0) {
    return `£${Number(listing.price_per_night).toLocaleString("en-GB", {
      maximumFractionDigits: 0,
    })} / night`;
  }
  return "No pricing";
};

const readinessTone = (status: ListingReadiness["status"]) => {
  if (status === "search_ready") return "success" as const;
  if (status === "needs_action") return "warning" as const;
  return "default" as const;
};

const readinessLabel = (status: ListingReadiness["status"]) => {
  if (status === "search_ready") return "Search ready";
  if (status === "needs_action") return "Needs action";
  return "Draft";
};

const formatBookingType = (listing: ListingRow) => {
  if (listing.is_shared_stay) return "Shared stay";
  if (listing.booking_unit === "hourly") return "Hourly";
  return "Nightly";
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:listings:read" });
  if ("redirect" in guard) return guard;

  const rawQ = typeof ctx.query.q === "string" ? ctx.query.q.trim() : "";
  const listingId = typeof ctx.query.listingId === "string" ? ctx.query.listingId.trim() : "";
  const q = rawQ || listingId;
  const admin = getSupabaseServerClient();
  const errors: string[] = [];

  const selects = [
    "id, user_id, title, location, booking_unit, rental_type, price_per_night, price_per_hour, is_shared_stay, shared_weekly_price_pence, airport_code, photos, created_at",
    "id, user_id, title, location, booking_unit, rental_type, price_per_night, price_per_hour, is_shared_stay, airport_code, photos, created_at",
    "id, user_id, title, location, booking_unit, price_per_night, price_per_hour, is_shared_stay, airport_code, photos, created_at",
    "id, user_id, title, location, booking_unit, price_per_night, is_shared_stay, airport_code, photos, created_at",
    "id, user_id, title, location, booking_unit, price_per_night, created_at",
  ];

  let listingRows: ListingRow[] = [];
  for (const select of selects) {
    const { data, error } = await admin
      .from("listings")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(200);

    listingRows = (data as unknown as ListingRow[]) ?? [];
    if (!error) break;
    if (!isMissingColumn(error)) {
      errors.push(`Listings could not be loaded: ${error.message}`);
      listingRows = [];
      break;
    }
  }

  const hostIds = Array.from(
    new Set(listingRows.map((listing) => listing.user_id).filter((id): id is string => Boolean(id)))
  );
  let hostProfiles: ProfileRow[] = [];
  if (hostIds.length > 0) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name, email, stripe_account_id, stripe_onboarding_status")
      .in("id", hostIds);
    if (error) {
      errors.push(`Host account state could not be loaded: ${error.message}`);
    } else {
      hostProfiles = (data as unknown as ProfileRow[]) ?? [];
    }
  }

  const profileMap = new Map(hostProfiles.map((profile) => [profile.id, profile]));
  const qLower = q.toLowerCase();
  const listings = listingRows
    .map<ListingWithReadiness>((listing) => {
      const host = listing.user_id ? profileMap.get(listing.user_id) ?? null : null;
      const stripeConnected =
        Boolean(host?.stripe_account_id) &&
        String(host?.stripe_onboarding_status ?? "").toLowerCase() === "complete";

      return {
        listing,
        host,
        readiness: evaluateListingReadiness(listing, {
          stripeConnected,
          availabilityConfigured: true,
        }),
      };
    })
    .filter(({ listing, host }) => {
      if (!qLower) return true;
      const haystack = [
        listing.id,
        listing.title ?? "",
        listing.location ?? "",
        listing.airport_code ?? "",
        host?.full_name ?? "",
        host?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(qLower);
    });

  return {
    props: {
      listings,
      staffRole: guard.staff.role,
      query: { q },
      errors,
    },
  };
};

export default function OpsListings({ listings, staffRole, query, errors }: PageProps) {
  return (
    <OpsLayout title="Listings" role={staffRole}>
      <div className="space-y-6">
        <OpsPageHeader
          title="Listings"
          description="Review search readiness, pricing, and payout setup across host supply."
        />

        <OpsErrorPanel messages={errors} />

        <OpsFilterBar>
          <div className="min-w-[320px] flex-1">
            <label className="mb-2 block text-sm font-medium text-slate-700">Search</label>
            <OpsSearchBar
              defaultValue={query.q}
              placeholder="Search listing, host, airport, location or listing ID"
            />
          </div>
        </OpsFilterBar>

        <OpsTable
          gridClassName="grid grid-cols-[1.5fr_1.1fr_0.95fr_1fr_0.85fr_0.75fr]"
          columns={["Listing", "Host", "Airport / type", "Readiness", "Pricing", "Created"]}
        >
          {listings.length === 0 ? (
            <div className="px-4 py-8">
              <OpsEmptyState title="No listings found." detail="When hosts create listings, they will appear here." />
            </div>
          ) : (
            listings.map(({ listing, host, readiness }) => {
              const hostName = host?.full_name?.trim() || host?.email || "Host";
              const stripeState = host?.stripe_account_id
                ? String(host?.stripe_onboarding_status ?? "").toLowerCase() === "complete"
                  ? "Stripe connected"
                  : "Stripe setup in progress"
                : "No Stripe account";

              return (
                <Link
                  key={listing.id}
                  href={`/ops/listings?q=${listing.id}`}
                  className="grid grid-cols-[1.5fr_1.1fr_0.95fr_1fr_0.85fr_0.75fr] gap-3 px-4 py-3.5 text-sm transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">
                      {listing.title?.trim() || "Untitled listing"}
                    </p>
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {listing.location ?? "Location not set"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatBookingType(listing)}
                      {listing.rental_type ? ` · ${listing.rental_type}` : ""}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{hostName}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">{host?.email ?? "No host email"}</p>
                    <p className="mt-1 text-xs text-slate-500">{stripeState}</p>
                  </div>

                  <div className="text-sm text-slate-700">
                    <p>{listing.airport_code ?? "No airport"}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {listing.is_shared_stay ? "Shared stay" : listing.booking_unit ?? "Nightly"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <OpsStatusBadge label={readinessLabel(readiness.status)} tone={readinessTone(readiness.status)} />
                    <p className="text-xs text-slate-600">
                      {readiness.supportedInPublicSearch
                        ? readiness.reasons[0] ?? "Visible in public search."
                        : "Not currently visible in public search."}
                    </p>
                  </div>

                  <div className="text-sm text-slate-900">{formatListingPrice(listing)}</div>

                  <div className="text-sm text-slate-600">{formatDate(listing.created_at)}</div>
                </Link>
              );
            })
          )}
        </OpsTable>
      </div>
    </OpsLayout>
  );
}
