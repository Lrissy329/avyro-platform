import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsEmptyState from "@/components/ops/OpsEmptyState";
import OpsFilterBar from "@/components/ops/OpsFilterBar";
import OpsLayout from "@/components/ops/OpsLayout";
import OpsMetric from "@/components/ops/OpsMetric";
import OpsPageHeader from "@/components/ops/OpsPageHeader";
import OpsStatusBadge from "@/components/ops/OpsStatusBadge";
import OpsTable from "@/components/ops/OpsTable";
import { isPaidFinalBookingStatus } from "@/lib/bookingStatus";
import { requireOpsStaff } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type PayoutRow = {
  id: string;
  listing_id?: string | null;
  host_id: string | null;
  status: string | null;
  payout_status: string | null;
  payout_released_at?: string | null;
  payout_transfer_id?: string | null;
  host_net_total_pence?: number | null;
  guest_total_pence?: number | null;
  currency?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
};

type ListingRow = {
  id: string;
  title: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type EnrichedPayoutRow = {
  booking: PayoutRow;
  listing: ListingRow | null;
  host: ProfileRow | null;
};

type PageProps = {
  rows: EnrichedPayoutRow[];
  query: {
    view: string;
  };
  staffRole: OpsRole;
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

const formatCurrency = (amountPence?: number | null, currency = "GBP") => {
  if (amountPence == null || !Number.isFinite(amountPence)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: amountPence % 100 === 0 ? 0 : 2,
  }).format(amountPence / 100);
};

const formatStatus = (value?: string | null) => {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
};

const paymentTone = (status?: string | null) => {
  if (isPaidFinalBookingStatus(status)) return "success" as const;
  if (["awaiting_payment", "pending_payment"].includes(String(status ?? "").toLowerCase())) return "warning" as const;
  if (["cancelled", "refunded", "payment_failed"].includes(String(status ?? "").toLowerCase())) return "danger" as const;
  return "default" as const;
};

const payoutTone = (status?: string | null) => {
  const value = String(status ?? "").toLowerCase();
  if (["paid", "complete"].includes(value)) return "success" as const;
  if (["awaiting_payout", "scheduled"].includes(value)) return "warning" as const;
  if (["failed"].includes(value)) return "danger" as const;
  return "default" as const;
};

const needsAttention = (booking: PayoutRow) => {
  const payoutStatus = String(booking.payout_status ?? "").toLowerCase();
  if (payoutStatus === "failed") return "Failed payout";
  if (isPaidFinalBookingStatus(booking.status) && !payoutStatus) return "Missing payout status";
  if (
    String(booking.status ?? "").toLowerCase() === "cancelled" &&
    ["awaiting_payout", "paid", "complete"].includes(payoutStatus)
  ) {
    return "Cancelled with financial activity";
  }
  return "None";
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:payouts:read" });
  if ("redirect" in guard) return guard;

  const view = typeof ctx.query.view === "string" ? ctx.query.view.trim() : "";
  const admin = getSupabaseServerClient();

  const { data } = await admin
    .from("bookings")
    .select(
      "id, listing_id, host_id, status, payout_status, payout_released_at, payout_transfer_id, host_net_total_pence, guest_total_pence, currency, check_in_time, check_out_time"
    )
    .order("check_in_time", { ascending: true })
    .limit(200);

  const bookingRows = (data ?? []) as PayoutRow[];
  const filteredRows = bookingRows.filter((row) => {
    const payoutStatus = String(row.payout_status ?? "").toLowerCase();
    if (view === "awaiting_payout") return payoutStatus === "awaiting_payout";
    if (view === "scheduled") return payoutStatus === "scheduled";
    if (view === "failed") return payoutStatus === "failed";
    if (view === "needs_review") return needsAttention(row) !== "None";
    return true;
  });

  const listingIds = Array.from(
    new Set(filteredRows.map((row) => row.listing_id).filter((id): id is string => Boolean(id)))
  );
  const hostIds = Array.from(
    new Set(filteredRows.map((row) => row.host_id).filter((id): id is string => Boolean(id)))
  );

  const [listingRes, profileRes] = await Promise.all([
    listingIds.length > 0
      ? admin.from("listings").select("id, title").in("id", listingIds)
      : Promise.resolve({ data: [], error: null } as any),
    hostIds.length > 0
      ? admin.from("profiles").select("id, full_name, email").in("id", hostIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const listingMap = new Map(((listingRes.data ?? []) as ListingRow[]).map((row) => [row.id, row]));
  const hostMap = new Map(((profileRes.data ?? []) as ProfileRow[]).map((row) => [row.id, row]));

  return {
    props: {
      rows: filteredRows.map((booking) => ({
        booking,
        listing: booking.listing_id ? listingMap.get(booking.listing_id) ?? null : null,
        host: booking.host_id ? hostMap.get(booking.host_id) ?? null : null,
      })),
      query: { view },
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsPayouts({ rows, query, staffRole }: PageProps) {
  const awaitingPayout = rows.filter(
    (row) => String(row.booking.payout_status ?? "").toLowerCase() === "awaiting_payout"
  ).length;
  const scheduled = rows.filter(
    (row) => String(row.booking.payout_status ?? "").toLowerCase() === "scheduled"
  ).length;
  const failed = rows.filter((row) => String(row.booking.payout_status ?? "").toLowerCase() === "failed").length;
  const review = rows.filter((row) => needsAttention(row.booking) !== "None").length;

  return (
    <OpsLayout title="Payments" role={staffRole}>
      <div className="space-y-6">
        <OpsPageHeader
          title="Payments"
          description="Track payment state, payout release timing, and payout anomalies."
        />

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OpsMetric
            label="Awaiting payout"
            value={String(awaitingPayout)}
            detail="Paid bookings waiting to move into payout flow."
            href="/ops/payouts?view=awaiting_payout"
            tone="warning"
            statusLabel={awaitingPayout > 0 ? "Needs action" : undefined}
          />
          <OpsMetric
            label="Scheduled"
            value={String(scheduled)}
            detail="Bookings with scheduled payout release."
            href="/ops/payouts?view=scheduled"
            tone="info"
            statusLabel={scheduled > 0 ? "Scheduled" : undefined}
          />
          <OpsMetric
            label="Failed"
            value={String(failed)}
            detail="Payouts that failed and need staff follow-up."
            href="/ops/payouts?view=failed"
            tone={failed > 0 ? "danger" : "default"}
            statusLabel={failed > 0 ? "Critical" : undefined}
          />
          <OpsMetric
            label="Needs review"
            value={String(review)}
            detail="Rows with missing or inconsistent payout state."
            href="/ops/payouts?view=needs_review"
            tone={review > 0 ? "warning" : "default"}
            statusLabel={review > 0 ? "Open alerts" : undefined}
          />
        </section>

        <OpsFilterBar>
          <div className="min-w-[220px]">
            <label className="mb-2 block text-sm font-medium text-slate-700">View</label>
            <select
              name="view"
              defaultValue={query.view}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
            >
              <option value="">All</option>
              <option value="awaiting_payout">Awaiting payout</option>
              <option value="scheduled">Scheduled</option>
              <option value="failed">Failed</option>
              <option value="needs_review">Needs review</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Apply
          </button>
        </OpsFilterBar>

        <OpsTable
          gridClassName="grid grid-cols-[1.35fr_1fr_0.9fr_0.9fr_0.8fr_0.75fr_0.95fr]"
          columns={["Booking / listing", "Host", "Payment status", "Payout status", "Amount", "Release", "Attention"]}
        >
          {rows.length === 0 ? (
            <div className="px-4 py-8">
              <OpsEmptyState title="No payment rows found for this view." />
            </div>
          ) : (
            rows.map(({ booking, listing, host }) => {
              const attention = needsAttention(booking);
              const hostName = host?.full_name?.trim() || host?.email || "Host";

              return (
                <Link
                  key={booking.id}
                  href={`/ops/bookings/${booking.id}`}
                  className="grid grid-cols-[1.35fr_1fr_0.9fr_0.9fr_0.8fr_0.75fr_0.95fr] gap-3 px-4 py-3.5 text-sm transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">
                      {listing?.title?.trim() || "Untitled listing"}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">Booking {booking.id.slice(0, 8)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDate(booking.check_in_time)} to {formatDate(booking.check_out_time)}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{hostName}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">{host?.email ?? "No host email"}</p>
                  </div>

                  <div className="space-y-2">
                    <OpsStatusBadge label={formatStatus(booking.status)} tone={paymentTone(booking.status)} />
                    {booking.payout_transfer_id ? (
                      <p className="text-xs text-slate-500">Transfer linked</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <OpsStatusBadge
                      label={formatStatus(booking.payout_status)}
                      tone={payoutTone(booking.payout_status)}
                    />
                    {booking.payout_transfer_id ? (
                      <p className="text-xs text-slate-500">
                        Transfer {booking.payout_transfer_id.slice(0, 12)}…
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">No transfer ID</p>
                    )}
                  </div>

                  <div className="text-sm text-slate-900">
                    <p>{formatCurrency(booking.host_net_total_pence, booking.currency ?? "GBP")}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Guest {formatCurrency(booking.guest_total_pence, booking.currency ?? "GBP")}
                    </p>
                  </div>

                  <div className="text-sm text-slate-600">{formatDate(booking.payout_released_at)}</div>

                  <div className="space-y-2">
                    {attention === "None" ? (
                      <span className="text-sm text-slate-500">No alerts</span>
                    ) : (
                      <OpsStatusBadge
                        label={attention}
                        tone={attention === "Failed payout" ? "danger" : "warning"}
                      />
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
