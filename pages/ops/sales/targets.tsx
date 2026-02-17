import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

type TargetRow = {
  id: string;
  area_id: string | null;
  staff_user_id: string | null;
  hosts_needed: number | null;
  target_date: string | null;
  created_at: string | null;
};

type AreaRow = {
  id: string;
  name: string;
  hosts_needed: number | null;
  target_date: string | null;
};

type StaffRow = {
  user_id: string;
  role: string;
  active: boolean;
};

type LeadRow = {
  id: string;
  area_target: string | null;
  assigned_sales_agent_id: string | null;
  status: string | null;
};

type TargetView = TargetRow & {
  areaName: string;
  agentLabel: string;
  hostsNeededResolved: number;
  targetDateResolved: string | null;
  claimedCount: number;
  leadCount: number;
  progressPct: number;
};

type PageProps = {
  staffRole: OpsRole;
  targets: TargetView[];
  attainmentPct: number;
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

const STATUS_STYLES: Record<string, string> = {
  lead_new: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  invited: "bg-sky-500/20 text-sky-200 border-sky-500/40",
  claimed: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  live: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  lost: "bg-rose-500/20 text-rose-200 border-rose-500/40",
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:sales:read" });
  if ("redirect" in guard) return guard;

  const admin = getSupabaseServerClient();
  const role = guard.staff.role as OpsRole;

  let targetsQuery = admin
    .from("sales_targets")
    .select("id, area_id, staff_user_id, hosts_needed, target_date, created_at")
    .order("target_date", { ascending: true });

  if (role === "sales_agent") {
    targetsQuery = targetsQuery.eq("staff_user_id", guard.staff.user_id);
  }

  const [{ data: targetsRaw }, { data: areas }, { data: staff }] = await Promise.all([
    targetsQuery,
    admin.from("areas").select("id, name, hosts_needed, target_date").order("name", {
      ascending: true,
    }),
    admin.from("staff_users").select("user_id, role, active").order("user_id", {
      ascending: true,
    }),
  ]);

  const targets = (targetsRaw ?? []) as TargetRow[];
  const areaMap = new Map((areas ?? []).map((area: AreaRow) => [area.id, area]));
  const staffMap = new Map((staff ?? []).map((member: StaffRow) => [member.user_id, member]));

  const areaNames = Array.from(areaMap.values()).map((area) => area.name);
  const staffIds = targets.map((target) => target.staff_user_id).filter(Boolean) as string[];

  let leads: LeadRow[] = [];
  if (areaNames.length > 0 && staffIds.length > 0) {
    const { data: leadsRaw } = await admin
      .from("host_leads")
      .select("id, area_target, assigned_sales_agent_id, status")
      .in("assigned_sales_agent_id", staffIds)
      .in("area_target", areaNames)
      .limit(5000);
    leads = (leadsRaw ?? []) as LeadRow[];
  }

  const targetViews: TargetView[] = targets.map((target) => {
    const area = target.area_id ? areaMap.get(target.area_id) : undefined;
    const staffUser = target.staff_user_id ? staffMap.get(target.staff_user_id) : undefined;
    const areaName = area?.name ?? "Unknown area";
    const agentLabel = staffUser?.user_id ?? "Unassigned";
    const hostsNeededResolved = target.hosts_needed ?? area?.hosts_needed ?? 0;
    const targetDateResolved = target.target_date ?? area?.target_date ?? null;
    const relatedLeads = leads.filter(
      (lead) =>
        lead.assigned_sales_agent_id === target.staff_user_id &&
        lead.area_target === areaName
    );
    const claimedCount = relatedLeads.filter(
      (lead) => lead.status === "claimed" || lead.status === "live"
    ).length;
    const progressPct =
      hostsNeededResolved > 0 ? Math.min(100, Math.round((claimedCount / hostsNeededResolved) * 100)) : 0;
    return {
      ...target,
      areaName,
      agentLabel,
      hostsNeededResolved,
      targetDateResolved,
      claimedCount,
      leadCount: relatedLeads.length,
      progressPct,
    };
  });

  const totalNeeded = targetViews.reduce((sum, target) => sum + (target.hostsNeededResolved || 0), 0);
  const totalClaimed = targetViews.reduce((sum, target) => sum + target.claimedCount, 0);
  const attainmentPct =
    totalNeeded > 0 ? Math.round((totalClaimed / totalNeeded) * 100) : 0;

  return {
    props: {
      staffRole: guard.staff.role as OpsRole,
      targets: targetViews,
      attainmentPct,
    },
  };
};

export default function SalesTargets({ staffRole, targets, attainmentPct }: PageProps) {
  return (
    <OpsLayout
      title="Sales targets"
      role={staffRole}
      kpis={[
        {
          label: "Target attainment",
          count: attainmentPct,
          href: "/ops/sales/targets",
          variant: attainmentPct >= 80 ? "success" : attainmentPct >= 50 ? "warning" : "danger",
        },
      ]}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Targets
            </p>
            <p className="mt-1 text-sm text-white">
              Progress is based on claimed and live hosts.
            </p>
          </div>
          <Link
            href="/ops/heatmap"
            className="rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
          >
            Go to heatmap
          </Link>
        </div>

        <div className="overflow-hidden rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)]">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr_1fr] gap-3 border-b border-[var(--ops-border)] px-4 py-3 text-xs uppercase tracking-[0.28em] text-[var(--ops-muted)]">
            <span>Area</span>
            <span>Agent</span>
            <span>Target</span>
            <span>Status</span>
            <span>Progress</span>
          </div>
          <div className="divide-y divide-[var(--ops-border)]">
            {targets.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[var(--ops-muted)]">
                No targets yet. Assign from the heatmap.
              </div>
            ) : (
              targets.map((target) => (
                <div
                  key={target.id}
                  className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr_1fr] gap-3 px-4 py-4 text-sm"
                >
                  <div>
                    <p className="font-semibold text-white">{target.areaName}</p>
                    <p className="text-xs text-[var(--ops-muted)]">
                      Due {formatDate(target.targetDateResolved)}
                    </p>
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">{target.agentLabel}</div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    {target.claimedCount} / {target.hostsNeededResolved} claimed
                    <div className="text-[10px] text-[var(--ops-muted)]">
                      {target.leadCount} leads
                    </div>
                  </div>
                  <div>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                        STATUS_STYLES[target.progressPct >= 100 ? "live" : "lead_new"] ??
                        "border-[var(--ops-border)] text-[var(--ops-muted)]"
                      }`}
                    >
                      {target.progressPct >= 100 ? "On target" : "In progress"}
                    </span>
                  </div>
                  <div>
                    <div className="h-2 w-full rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-emerald-400"
                        style={{ width: `${target.progressPct}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-[var(--ops-muted)]">
                      {target.progressPct}% attainment
                    </p>
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
