import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsEmptyState from "@/components/ops/OpsEmptyState";
import OpsErrorPanel from "@/components/ops/OpsErrorPanel";
import OpsFilterBar from "@/components/ops/OpsFilterBar";
import OpsLayout from "@/components/ops/OpsLayout";
import OpsMetric from "@/components/ops/OpsMetric";
import OpsPageHeader from "@/components/ops/OpsPageHeader";
import OpsSearchBar from "@/components/ops/OpsSearchBar";
import OpsStatusBadge, { type OpsStatusTone } from "@/components/ops/OpsStatusBadge";
import OpsTable from "@/components/ops/OpsTable";
import { isPaidFinalBookingStatus } from "@/lib/bookingStatus";
import { requireOpsStaff } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type BookingRow = {
  id: string;
  listing_id: string | null;
  guest_id: string | null;
  host_id: string | null;
  status: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  price_total: number | null;
  currency: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  needs_review?: boolean | null;
  created_at?: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ListingRow = {
  id: string;
  title: string | null;
  location: string | null;
};

type EnrichedBooking = {
  booking: BookingRow;
  listing: ListingRow | null;
  guest: ProfileRow | null;
  host: ProfileRow | null;
};

type PageProps = {
  bookings: EnrichedBooking[];
  query: {
    q: string;
    status: string;
    needsReview: string;
  };
  staffRole: OpsRole;
  errors: string[];
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
  }).format(date);
};

const formatCurrency = (value?: number | null, currency = "GBP") => {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const statusTone = (value?: string | null): OpsStatusTone => {
  const status = String(value ?? "").toLowerCase();
  if (["confirmed", "paid"].includes(status)) return "success";
  if (["awaiting_payment", "pending_payment"].includes(status)) return "warning";
  if (["cancelled", "refunded", "payment_failed", "payout_failed"].includes(status)) return "danger";
  if (status) return "info";
  return "default";
};

const formatStatusLabel = (value?: string | null) => {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
};

const displayPerson = (profile: ProfileRow | null, fallbackId?: string | null, fallbackLabel = "Unknown") => {
  const name = profile?.full_name?.trim();
  const email = profile?.email?.trim();
  return {
    name: name || email || fallbackLabel,
    detail: email || (fallbackId ? `${fallbackId.slice(0, 8)}…` : "—"),
  };
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:bookings:read" });
  if ("redirect" in guard) return guard;

  const q = typeof ctx.query.q === "string" ? ctx.query.q.trim() : "";
  const status = typeof ctx.query.status === "string" ? ctx.query.status.trim() : "";
  const needsReview = typeof ctx.query.needsReview === "string" ? ctx.query.needsReview.trim() : "";

  const admin = getSupabaseServerClient();
  const errors: string[] = [];

  let query = admin
    .from("bookings")
    .select(
      "id, listing_id, guest_id, host_id, status, check_in_time, check_out_time, price_total, currency, stripe_payment_intent_id, stripe_checkout_session_id, needs_review, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status === "confirmed") {
    query = query.in("status", ["confirmed", "paid"]);
  } else if (status) {
    query = query.eq("status", status);
  }

  if (needsReview === "1") {
    query = query.eq("needs_review", true);
  }

  if (q && isUuid(q)) {
    query = query.or(`id.eq.${q},listing_id.eq.${q},guest_id.eq.${q},host_id.eq.${q}`);
  }

  const { data, error } = await query;
  if (error) {
    errors.push(`Bookings could not be loaded: ${error.message}`);
  }

  const bookingRows = (data ?? []) as BookingRow[];
  const listingIds = Array.from(
    new Set(bookingRows.map((row) => row.listing_id).filter((id): id is string => Boolean(id)))
  );
  const profileIds = Array.from(
    new Set(bookingRows.flatMap((row) => [row.guest_id, row.host_id]).filter((id): id is string => Boolean(id)))
  );

  const [listingRes, profileRes] = await Promise.all([
    listingIds.length > 0
      ? admin.from("listings").select("id, title, location").in("id", listingIds)
      : Promise.resolve({ data: [], error: null } as any),
    profileIds.length > 0
      ? admin.from("profiles").select("id, full_name, email").in("id", profileIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (listingRes.error) {
    errors.push(`Listing summaries could not be loaded: ${listingRes.error.message}`);
  }
  if (profileRes.error) {
    errors.push(`Guest and host summaries could not be loaded: ${profileRes.error.message}`);
  }

  const listingMap = new Map(((listingRes.data ?? []) as ListingRow[]).map((row) => [row.id, row]));
  const profileMap = new Map(((profileRes.data ?? []) as ProfileRow[]).map((row) => [row.id, row]));

  let bookings: EnrichedBooking[] = bookingRows.map((booking) => ({
    booking,
    listing: booking.listing_id ? listingMap.get(booking.listing_id) ?? null : null,
    guest: booking.guest_id ? profileMap.get(booking.guest_id) ?? null : null,
    host: booking.host_id ? profileMap.get(booking.host_id) ?? null : null,
  }));

  if (q && !isUuid(q)) {
    const qLower = q.toLowerCase();
    bookings = bookings.filter(({ booking, listing, guest, host }) =>
      [
        booking.id,
        listing?.title ?? "",
        listing?.location ?? "",
        guest?.full_name ?? "",
        guest?.email ?? "",
        host?.full_name ?? "",
        host?.email ?? "",
        booking.stripe_payment_intent_id ?? "",
        booking.stripe_checkout_session_id ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(qLower)
    );
  }

  return {
    props: {
      bookings,
      query: { q, status, needsReview },
      staffRole: guard.staff.role,
      errors,
    },
  };
};

export default function OpsBookings({ bookings, query, staffRole, errors }: PageProps) {
  const awaitingPaymentCount = bookings.filter((row) =>
    ["awaiting_payment", "pending_payment"].includes(String(row.booking.status ?? "").toLowerCase())
  ).length;
  const confirmedCount = bookings.filter((row) => isPaidFinalBookingStatus(row.booking.status)).length;
  const needsReviewCount = bookings.filter((row) => row.booking.needs_review).length;
  const cancelledCount = bookings.filter((row) =>
    ["cancelled", "refunded"].includes(String(row.booking.status ?? "").toLowerCase())
  ).length;

  return (
    <OpsLayout title="Bookings" role={staffRole}>
      <div className="space-y-6">
        <OpsPageHeader title="Bookings" description="Search, filter, and inspect active booking flow." />

        <OpsErrorPanel messages={errors} />

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OpsMetric
            label="Awaiting payment"
            value={String(awaitingPaymentCount)}
            detail="Bookings still waiting for checkout completion."
            href="/ops/bookings?status=awaiting_payment"
            tone="warning"
            statusLabel={awaitingPaymentCount > 0 ? "Needs action" : undefined}
          />
          <OpsMetric
            label="Confirmed"
            value={String(confirmedCount)}
            detail="Paid or confirmed bookings in the current result set."
            href="/ops/bookings?status=confirmed"
            tone="success"
            statusLabel={confirmedCount > 0 ? "Healthy" : undefined}
          />
          <OpsMetric
            label="Needs review"
            value={String(needsReviewCount)}
            detail="Bookings flagged for manual ops attention."
            href="/ops/bookings?needsReview=1"
            tone={needsReviewCount > 0 ? "danger" : "default"}
            statusLabel={needsReviewCount > 0 ? "Open alerts" : undefined}
          />
          <OpsMetric
            label="Cancelled or refunded"
            value={String(cancelledCount)}
            detail="Recently cancelled or refunded bookings."
            href="/ops/bookings?status=cancelled"
            tone={cancelledCount > 0 ? "info" : "default"}
            statusLabel={cancelledCount > 0 ? "Info" : undefined}
          />
        </section>

        <OpsFilterBar>
          <div className="min-w-[280px] flex-1">
            <label className="mb-2 block text-sm font-medium text-slate-700">Search</label>
            <OpsSearchBar
              defaultValue={query.q}
              placeholder="Search booking, listing, guest, host or Stripe ID"
            />
          </div>

          <div className="min-w-[180px]">
            <label className="mb-2 block text-sm font-medium text-slate-700">Status</label>
            <select
              name="status"
              defaultValue={query.status}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
            >
              <option value="">All statuses</option>
              <option value="awaiting_payment">Awaiting payment</option>
              <option value="pending_payment">Pending payment</option>
              <option value="confirmed">Confirmed</option>
              <option value="paid">Paid (legacy)</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
              <option value="payout_failed">Payout failed</option>
            </select>
          </div>

          <div className="min-w-[180px]">
            <label className="mb-2 block text-sm font-medium text-slate-700">Flags</label>
            <select
              name="needsReview"
              defaultValue={query.needsReview}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
            >
              <option value="">All bookings</option>
              <option value="1">Needs review</option>
            </select>
          </div>
        </OpsFilterBar>

        <OpsTable
          gridClassName="grid grid-cols-[1.45fr_1fr_1fr_0.9fr_0.85fr_0.7fr_0.85fr]"
          columns={["Booking", "Guest", "Host", "Dates", "Status", "Total", "Flags"]}
        >
          {bookings.length === 0 ? (
            <div className="px-4 py-8">
              <OpsEmptyState title="No bookings match these filters." />
            </div>
          ) : (
            bookings.map(({ booking, listing, guest, host }) => {
              const guestDisplay = displayPerson(guest, booking.guest_id, "Guest");
              const hostDisplay = displayPerson(host, booking.host_id, "Host");
              const flags = [];
              if (booking.needs_review) flags.push("Needs review");
              if (booking.stripe_checkout_session_id) flags.push("Checkout session");
              if (booking.stripe_payment_intent_id) flags.push("Payment intent");

              return (
                <Link
                  key={booking.id}
                  href={`/ops/bookings/${booking.id}`}
                  className="grid grid-cols-[1.45fr_1fr_1fr_0.9fr_0.85fr_0.7fr_0.85fr] gap-3 px-4 py-3.5 text-sm transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">
                      {listing?.title?.trim() || "Untitled listing"}
                    </p>
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {listing?.location ?? "Location not set"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Booking {booking.id.slice(0, 8)}</p>
                    {booking.stripe_payment_intent_id ? (
                      <p className="mt-1 text-xs text-slate-500">
                        PI {booking.stripe_payment_intent_id.slice(0, 14)}…
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{guestDisplay.name}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">{guestDisplay.detail}</p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{hostDisplay.name}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">{hostDisplay.detail}</p>
                  </div>

                  <div className="text-sm text-slate-700">
                    <p>
                      {formatDate(booking.check_in_time)} to {formatDate(booking.check_out_time)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Created {formatDate(booking.created_at)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <OpsStatusBadge
                      label={formatStatusLabel(booking.status)}
                      tone={statusTone(booking.status)}
                    />
                    {booking.needs_review ? (
                      <OpsStatusBadge label="Needs review" tone="danger" />
                    ) : null}
                  </div>

                  <div className="font-medium text-slate-900">
                    {formatCurrency(booking.price_total, booking.currency ?? "GBP")}
                  </div>

                  <div className="space-y-1 text-xs text-slate-600">
                    {flags.length === 0 ? (
                      <span>No flags</span>
                    ) : (
                      flags.map((flag) => <div key={flag}>{flag}</div>)
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </OpsTable>
      </div>
    </OpsLayout>
  );
}
