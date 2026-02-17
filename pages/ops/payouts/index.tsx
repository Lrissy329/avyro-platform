import type { GetServerSideProps } from "next";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

type PayoutRow = {
  id: string;
  host_id: string | null;
  status: string | null;
  payout_status: string | null;
  payout_released_at?: string | null;
  payout_transfer_id?: string | null;
  host_net_total_pence?: number | null;
  currency?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
};

type PageProps = {
  rows: PayoutRow[];
  query: {
    status: string;
    needsAttention: string;
  };
  staffRole: OpsRole;
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:payouts:read" });
  if ("redirect" in guard) return guard;

  const status = typeof ctx.query.status === "string" ? ctx.query.status.trim() : "";
  const needsAttention =
    typeof ctx.query.needsAttention === "string" ? ctx.query.needsAttention.trim() : "";

  const admin = getSupabaseServerClient();
  let query = admin
    .from("bookings")
    .select(
      "id, host_id, status, payout_status, payout_released_at, payout_transfer_id, host_net_total_pence, currency, check_in_time, check_out_time"
    )
    .order("check_in_time", { ascending: true })
    .limit(200);

  if (status) {
    query = query.eq("payout_status", status);
  }

  if (needsAttention === "1") {
    query = query.eq("payout_status", "failed");
  }

  const { data } = await query;

  return {
    props: {
      rows: data ?? [],
      query: { status, needsAttention },
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsPayouts({ rows, query, staffRole }: PageProps) {
  return (
    <OpsLayout
      title="Payouts"
      role={staffRole}
      kpis={[
        {
          label: "Scheduled",
          count: rows.filter((r) => r.payout_status === "scheduled").length,
          href: "/ops/payouts?status=scheduled",
          variant: "info",
        },
        {
          label: "Failed",
          count: rows.filter((r) => r.payout_status === "failed").length,
          href: "/ops/payouts?needsAttention=1",
          variant: "danger",
        },
      ]}
    >
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-4"
          method="get"
        >
          <div className="flex min-w-[180px] flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Payout status
            </label>
            <select
              name="status"
              defaultValue={query.status}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">All</option>
              <option value="scheduled">Scheduled</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="flex min-w-[200px] flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Needs attention
            </label>
            <select
              name="needsAttention"
              defaultValue={query.needsAttention}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">All</option>
              <option value="1">Failed only</option>
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
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr] gap-3 border-b border-[var(--ops-border)] px-4 py-3 text-xs uppercase tracking-[0.28em] text-[var(--ops-muted)]">
            <span>Booking</span>
            <span>Host</span>
            <span>Payout status</span>
            <span>Amount</span>
            <span>Release</span>
          </div>
          <div className="divide-y divide-[var(--ops-border)]">
            {rows.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[var(--ops-muted)]">
                No payouts found.
              </div>
            ) : (
              rows.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 text-sm"
                >
                  <div className="text-white">{row.id}</div>
                  <div className="text-xs text-[var(--ops-muted)]">{row.host_id ?? "—"}</div>
                  <div className="text-xs text-[var(--ops-muted)]">{row.payout_status ?? "—"}</div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    {row.host_net_total_pence != null
                      ? `${row.currency ?? "GBP"} ${(row.host_net_total_pence / 100).toFixed(0)}`
                      : "—"}
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    {formatDate(row.payout_released_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
