import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

const STATUS_STYLES: Record<string, string> = {
  lead_new: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  invited: "bg-sky-500/20 text-sky-200 border-sky-500/40",
  claimed: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  live: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  lost: "bg-rose-500/20 text-rose-200 border-rose-500/40",
};

type LeadRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  assigned_sales_agent_id: string | null;
  converted_host_user_id: string | null;
  last_activity_at: string | null;
  created_at: string | null;
};

type Metrics = {
  hostsOnboarded: number;
  firstBookingCompleted: number;
  commissionPending: number;
};

type PageProps = {
  staffRole: OpsRole;
  metrics: Metrics;
  recentLeads: LeadRow[];
  leadCounts: {
    leadNew: number;
    invited: number;
    claimed: number;
    live: number;
  };
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:sales:read" });
  if ("redirect" in guard) return guard;

  const admin = getSupabaseServerClient();
  const role = guard.staff.role as OpsRole;

  let leadsQuery = admin
    .from("host_leads")
    .select(
      "id, full_name, email, status, assigned_sales_agent_id, converted_host_user_id, last_activity_at, created_at"
    )
    .order("last_activity_at", { ascending: false })
    .limit(200);

  if (role === "sales_agent") {
    leadsQuery = leadsQuery.eq("assigned_sales_agent_id", guard.staff.user_id);
  }

  const { data: leads } = await leadsQuery;
  const leadRows = (leads ?? []) as LeadRow[];

  const hostIds = leadRows
    .map((lead) => lead.converted_host_user_id)
    .filter((id): id is string => Boolean(id));

  let bookings: any[] = [];
  if (hostIds.length > 0) {
    const { data } = await admin
      .from("bookings")
      .select("id, host_id, status, payout_status")
      .in("host_id", hostIds)
      .limit(500);
    bookings = data ?? [];
  }

  const confirmedBookings = bookings.filter((row) => row.status === "confirmed");
  const firstBookingHosts = new Set(confirmedBookings.map((row) => row.host_id).filter(Boolean));
  const commissionPending = confirmedBookings.filter(
    (row) => row.payout_status !== "paid" && row.payout_status !== "in_transit"
  ).length;

  const leadCounts = {
    leadNew: leadRows.filter((lead) => lead.status === "lead_new").length,
    invited: leadRows.filter((lead) => lead.status === "invited").length,
    claimed: leadRows.filter((lead) => lead.status === "claimed").length,
    live: leadRows.filter((lead) => lead.status === "live").length,
  };

  return {
    props: {
      staffRole: guard.staff.role as OpsRole,
      metrics: {
        hostsOnboarded: hostIds.length,
        firstBookingCompleted: firstBookingHosts.size,
        commissionPending,
      },
      recentLeads: leadRows.slice(0, 6),
      leadCounts,
    },
  };
};

export default function SalesDashboard({ staffRole, metrics, recentLeads, leadCounts }: PageProps) {
  return (
    <OpsLayout
      title="Sales dashboard"
      role={staffRole}
      kpis={[
        {
          label: "New",
          count: leadCounts.leadNew,
          href: "/ops/sales/leads?status=lead_new",
          variant: "warning",
        },
        {
          label: "Invited",
          count: leadCounts.invited,
          href: "/ops/sales/leads?status=invited",
          variant: "info",
        },
        {
          label: "Claimed",
          count: leadCounts.claimed,
          href: "/ops/sales/leads?status=claimed",
          variant: "success",
        },
      ]}
    >
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                Hosts onboarded
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">{metrics.hostsOnboarded}</p>
            </div>
            <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                First booking completed
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {metrics.firstBookingCompleted}
              </p>
            </div>
            <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                Commission pending
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">{metrics.commissionPending}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)]">
            <div className="flex items-center justify-between border-b border-[var(--ops-border)] px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Recent leads
                </p>
                <p className="mt-1 text-sm text-white">Quick access to active leads.</p>
              </div>
              <Link
                href="/ops/sales/leads"
                className="rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-3 py-1 text-xs font-semibold !text-white"
              >
                View all
              </Link>
            </div>
            <div className="divide-y divide-[var(--ops-border)]">
              {recentLeads.length === 0 ? (
                <div className="px-5 py-6 text-sm text-[var(--ops-muted)]">No leads yet.</div>
              ) : (
                recentLeads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/ops/sales/leads/${lead.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 text-sm transition hover:bg-slate-50"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        {lead.full_name ?? lead.email ?? lead.id}
                      </div>
                      <div className="text-xs text-[var(--ops-muted)]">
                        {lead.email ?? "—"} · Last activity{" "}
                        {formatDate(lead.last_activity_at ?? lead.created_at)}
                      </div>
                    </div>
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                        STATUS_STYLES[lead.status ?? ""] ??
                        "border-[var(--ops-border)] text-[var(--ops-muted)]"
                      }`}
                    >
                      {lead.status ?? "—"}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Action stack</p>
            <div className="mt-4 space-y-3 text-sm text-[var(--ops-muted)]">
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                Focus on leads without recent activity to improve conversion.
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                Use invites for warm leads and follow up within 48 hours.
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                Log notes on every outbound touch for pipeline visibility.
              </div>
            </div>
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
