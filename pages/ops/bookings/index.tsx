import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

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
  needs_review?: boolean | null;
  created_at?: string | null;
};

type PageProps = {
  bookings: BookingRow[];
  query: {
    q: string;
    status: string;
  };
  staffRole: OpsRole;
};

const STATUS_STYLES: Record<string, string> = {
  awaiting_payment: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  pending_payment: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  confirmed: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  payment_failed: "bg-rose-500/20 text-rose-200 border-rose-500/40",
  cancelled: "bg-rose-500/20 text-rose-200 border-rose-500/40",
  refunded: "bg-purple-500/20 text-purple-200 border-purple-500/40",
  payout_failed: "bg-orange-500/20 text-orange-200 border-orange-500/40",
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:bookings:read" });
  if ("redirect" in guard) return guard;

  const q = typeof ctx.query.q === "string" ? ctx.query.q.trim() : "";
  const status = typeof ctx.query.status === "string" ? ctx.query.status.trim() : "";
  const needsReview = typeof ctx.query.needsReview === "string" ? ctx.query.needsReview : "";

  const admin = getSupabaseServerClient();
  let query = admin
    .from("bookings")
    .select(
      "id, listing_id, guest_id, host_id, status, check_in_time, check_out_time, price_total, currency, needs_review, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) {
    query = query.eq("status", status);
  }

  if (needsReview === "1") {
    query = query.eq("needs_review", true);
  }

  if (q && isUuid(q)) {
    query = query.or(`id.eq.${q},listing_id.eq.${q},guest_id.eq.${q},host_id.eq.${q}`);
  }

  const { data } = await query;

  return {
    props: {
      bookings: data ?? [],
      query: { q, status },
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsBookings({ bookings, query, staffRole }: PageProps) {
  return (
    <OpsLayout
      title="Bookings"
      role={staffRole}
      kpis={[
        {
          label: "Awaiting payment",
          count: bookings.filter((b) => (b.status ?? "").includes("awaiting")).length,
          href: "/ops/bookings?status=awaiting_payment",
          variant: "warning",
        },
        {
          label: "Confirmed",
          count: bookings.filter((b) => b.status === "confirmed").length,
          href: "/ops/bookings?status=confirmed",
          variant: "success",
        },
        {
          label: "Needs review",
          count: bookings.filter((b) => b.needs_review).length,
          href: "/ops/bookings?needsReview=1",
          variant: "danger",
        },
      ]}
    >
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-4"
          method="get"
        >
          <div className="flex min-w-[220px] flex-1 flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Search
            </label>
            <input
              name="q"
              defaultValue={query.q}
              placeholder="Booking / listing / guest id"
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="flex min-w-[180px] flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Status
            </label>
            <select
              name="status"
              defaultValue={query.status}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">All</option>
              <option value="awaiting_payment">Awaiting payment</option>
              <option value="pending_payment">Pending payment</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
              <option value="payout_failed">Payout failed</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
          >
            Apply
          </button>
        </form>

        <div className="overflow-hidden rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)]">
          <div className="grid grid-cols-[1.6fr_1.1fr_1fr_1fr_0.8fr_0.6fr] gap-3 border-b border-[var(--ops-border)] px-4 py-3 text-xs uppercase tracking-[0.28em] text-[var(--ops-muted)]">
            <span>Booking</span>
            <span>Guest / Host</span>
            <span>Dates</span>
            <span>Status</span>
            <span>Total</span>
            <span>Flags</span>
          </div>

          <div className="divide-y divide-[var(--ops-border)]">
            {bookings.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[var(--ops-muted)]">
                No bookings found for these filters.
              </div>
            ) : (
              bookings.map((booking) => (
                <Link
                  key={booking.id}
                  href={`/ops/bookings/${booking.id}`}
                  className="grid grid-cols-[1.6fr_1.1fr_1fr_1fr_0.8fr_0.6fr] gap-3 px-4 py-3 text-sm transition hover:bg-slate-50"
                >
                  <div className="space-y-1">
                    <div className="font-semibold text-white">{booking.id}</div>
                    <div className="text-xs text-[var(--ops-muted)]">
                      Listing: {booking.listing_id ?? "—"}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    <div>Guest: {booking.guest_id ?? "—"}</div>
                    <div>Host: {booking.host_id ?? "—"}</div>
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    {formatDate(booking.check_in_time)} → {formatDate(booking.check_out_time)}
                  </div>
                  <div>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                        STATUS_STYLES[booking.status ?? ""] ??
                        "border-[var(--ops-border)] text-[var(--ops-muted)]"
                      }`}
                    >
                      {booking.status ?? "unknown"}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    {booking.price_total != null ? `${booking.currency ?? "GBP"} ${booking.price_total}` : "—"}
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    {booking.needs_review ? "Needs review" : "—"}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
