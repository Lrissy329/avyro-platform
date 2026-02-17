import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { hasOpsPermission, type OpsRole } from "@/lib/opsRbac";

type LeadRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  assigned_sales_agent_id: string | null;
  area_target: string | null;
  commission_plan: string | null;
  converted_host_user_id: string | null;
  last_activity_at: string | null;
  created_at: string | null;
};

type StaffRow = {
  user_id: string;
  role: string;
  active: boolean;
};

type PageProps = {
  leads: LeadRow[];
  staff: StaffRow[];
  staffRole: OpsRole;
  staffUserId: string;
  inviteTokens: Record<string, string>;
  query: {
    q: string;
    status: string;
    assignee: string;
    scope: string;
    prefillArea: string;
  };
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

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

const getUrgency = (value?: string | null) => {
  if (!value) {
    return { label: "No signal", className: "bg-slate-500/30 text-slate-200" };
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return { label: "No signal", className: "bg-slate-500/30 text-slate-200" };
  }
  const days = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 2) return { label: "Hot", className: "bg-emerald-500/20 text-emerald-200" };
  if (days <= 7) return { label: "Warm", className: "bg-amber-500/20 text-amber-200" };
  return { label: "Cold", className: "bg-rose-500/20 text-rose-200" };
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:sales:read" });
  if ("redirect" in guard) return guard;

  const q = typeof ctx.query.q === "string" ? ctx.query.q.trim() : "";
  const status = typeof ctx.query.status === "string" ? ctx.query.status.trim() : "";
  const scope =
    typeof ctx.query.scope === "string" && ctx.query.scope === "all" ? "all" : "mine";
  let assignee = typeof ctx.query.assignee === "string" ? ctx.query.assignee.trim() : "";
  const prefillArea =
    typeof ctx.query.prefillArea === "string" ? ctx.query.prefillArea.trim() : "";

  const admin = getSupabaseServerClient();
  let query = admin
    .from("host_leads")
    .select(
      "id, full_name, email, status, assigned_sales_agent_id, area_target, commission_plan, converted_host_user_id, last_activity_at, created_at"
    )
    .order("last_activity_at", { ascending: false })
    .limit(200);

  const role = guard.staff.role as OpsRole;
  if (role === "sales_agent") {
    assignee = guard.staff.user_id;
    query = query.eq("assigned_sales_agent_id", guard.staff.user_id);
  }

  if (scope !== "all" && !assignee) {
    assignee = guard.staff.user_id;
  }

  if (status) query = query.eq("status", status);
  if (assignee) query = query.eq("assigned_sales_agent_id", assignee);
  if (q) {
    if (isUuid(q)) {
      query = query.or(`id.eq.${q},converted_host_user_id.eq.${q}`);
    } else {
      query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
    }
  }

  const [{ data: leads }, { data: staff }] = await Promise.all([
    query,
    admin.from("staff_users").select("user_id, role, active").order("user_id", {
      ascending: true,
    }),
  ]);

  const leadIds = (leads ?? []).map((lead) => lead.id).filter(Boolean);
  let inviteTokens: Record<string, string> = {};
  if (leadIds.length > 0) {
    const { data: invites } = await admin
      .from("host_invites")
      .select("lead_id, token, created_at")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false });

    (invites ?? []).forEach((invite) => {
      if (invite?.lead_id && !inviteTokens[invite.lead_id]) {
        inviteTokens[invite.lead_id] = invite.token;
      }
    });
  }

  return {
    props: {
      leads: leads ?? [],
      staff: staff ?? [],
      staffRole: guard.staff.role as OpsRole,
      staffUserId: guard.staff.user_id,
      inviteTokens,
      query: { q, status, assignee, scope, prefillArea },
    },
  };
};

export default function OpsSalesLeads({
  leads,
  staff,
  staffRole,
  staffUserId,
  inviteTokens,
  query,
}: PageProps) {
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [actionState, setActionState] = useState<Record<string, string>>({});
  const [scope, setScope] = useState(staffRole === "sales_agent" ? "mine" : query.scope || "mine");
  const [showNewLead, setShowNewLead] = useState(Boolean(query.prefillArea));
  const [formStatus, setFormStatus] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [newLead, setNewLead] = useState({
    full_name: "",
    email: "",
    phone: "",
    area_target: query.prefillArea ?? "",
    commission_plan: "",
    assigned_sales_agent_id: staffRole === "sales_agent" ? staffUserId : "",
  });
  const canWrite = hasOpsPermission(staffRole, "ops:sales:write");
  const staffOptions = useMemo(() => {
    const eligible = staff.filter(
      (member) => member.role === "sales_agent" || member.role === "admin"
    );
    if (staffRole !== "sales_agent") return eligible;
    return eligible.filter((member) => member.user_id === staffUserId);
  }, [staff, staffRole, staffUserId]);

  const sendInvite = async (leadId: string) => {
    setActionState((prev) => ({ ...prev, [leadId]: "Sending invite..." }));
    try {
      const resp = await fetch("/api/ops/sales/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Invite failed");
      if (payload?.inviteUrl) {
        setInviteLinks((prev) => ({ ...prev, [leadId]: payload.inviteUrl }));
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(payload.inviteUrl);
          setActionState((prev) => ({ ...prev, [leadId]: "Invite link copied" }));
        } else {
          setActionState((prev) => ({ ...prev, [leadId]: "Invite ready" }));
        }
      }
    } catch (err: any) {
      setActionState((prev) => ({ ...prev, [leadId]: err?.message ?? "Invite failed" }));
    }
  };

  const copyInvite = async (leadId: string) => {
    const fallbackToken = inviteTokens[leadId];
    const inviteUrl =
      inviteLinks[leadId] ??
      (fallbackToken ? `${window.location.origin}/onboard/host?token=${fallbackToken}` : "");
    if (!inviteUrl) {
      setActionState((prev) => ({ ...prev, [leadId]: "No invite link available" }));
      return;
    }
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(inviteUrl);
      setActionState((prev) => ({ ...prev, [leadId]: "Invite link copied" }));
    } else {
      setActionState((prev) => ({ ...prev, [leadId]: inviteUrl }));
    }
  };

  const markLost = async (leadId: string) => {
    setActionState((prev) => ({ ...prev, [leadId]: "Marking lost..." }));
    try {
      const resp = await fetch("/api/ops/sales/leads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, status: "lost" }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Update failed");
      window.location.reload();
    } catch (err: any) {
      setActionState((prev) => ({ ...prev, [leadId]: err?.message ?? "Update failed" }));
    }
  };

  const createLead = async () => {
    setFormStatus("Creating lead...");
    setFormError(null);
    try {
      const resp = await fetch("/api/ops/sales/leads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newLead),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Create failed");
      if (payload?.id) {
        window.location.href = `/ops/sales/leads/${payload.id}`;
        return;
      }
      window.location.reload();
    } catch (err: any) {
      setFormError(err?.message ?? "Create failed");
      setFormStatus(null);
    }
  };

  return (
    <OpsLayout
      title="Sales leads"
      role={staffRole}
      kpis={[
        {
          label: "New",
          count: leads.filter((l) => l.status === "lead_new").length,
          href: "/ops/sales/leads?status=lead_new",
          variant: "warning",
        },
        {
          label: "Invited",
          count: leads.filter((l) => l.status === "invited").length,
          href: "/ops/sales/leads?status=invited",
          variant: "info",
        },
        {
          label: "Claimed",
          count: leads.filter((l) => l.status === "claimed").length,
          href: "/ops/sales/leads?status=claimed",
          variant: "success",
        },
      ]}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel)] px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Pipeline</p>
            <p className="mt-1 text-sm text-white">Default view is My Leads.</p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowNewLead(true)}
              className="rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
            >
              New lead
            </button>
          )}
        </div>
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
              placeholder="Lead name / email / id"
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="flex min-w-[160px] flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Status
            </label>
            <select
              name="status"
              defaultValue={query.status}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">All</option>
              <option value="lead_new">Lead new</option>
              <option value="invited">Invited</option>
              <option value="claimed">Claimed</option>
              <option value="live">Live</option>
              <option value="lost">Lost</option>
            </select>
          </div>
          <div className="flex min-w-[160px] flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Scope
            </label>
            <select
              name="scope"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              disabled={staffRole === "sales_agent"}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
            >
              <option value="mine">My leads</option>
              {staffRole !== "sales_agent" && <option value="all">All leads</option>}
            </select>
          </div>
          <div className="flex min-w-[200px] flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Assignee
            </label>
            {scope === "mine" && <input type="hidden" name="assignee" value={staffUserId} />}
            <select
              key={scope}
              name="assignee"
              defaultValue={scope === "mine" ? staffUserId : query.assignee}
              disabled={scope === "mine"}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
            >
              <option value="">All</option>
              {staffOptions.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.user_id}
                </option>
              ))}
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
          <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr_0.9fr_0.8fr_1.1fr] gap-3 border-b border-[var(--ops-border)] px-4 py-3 text-xs uppercase tracking-[0.28em] text-[var(--ops-muted)]">
            <span>Lead</span>
            <span>Status</span>
            <span>Urgency</span>
            <span>Assignee</span>
            <span>Area</span>
            <span>Actions</span>
          </div>
          <div className="divide-y divide-[var(--ops-border)]">
            {leads.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[var(--ops-muted)]">No leads found.</div>
            ) : (
              leads.map((lead) => {
                const urgency = getUrgency(lead.last_activity_at ?? lead.created_at);
                const inviteToken = inviteTokens[lead.id];
                return (
                <div
                  key={lead.id}
                  className="grid grid-cols-[1.2fr_0.8fr_0.7fr_0.9fr_0.8fr_1.1fr] gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <Link href={`/ops/sales/leads/${lead.id}`} className="font-semibold text-white">
                      {lead.full_name ?? lead.email ?? lead.id}
                    </Link>
                    <div className="text-xs text-[var(--ops-muted)]">{lead.email ?? "—"}</div>
                    <div className="text-[10px] text-[var(--ops-muted)]">
                      Last touch {formatDate(lead.last_activity_at ?? lead.created_at)}
                    </div>
                  </div>
                  <div>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                        STATUS_STYLES[lead.status ?? ""] ??
                        "border-[var(--ops-border)] text-[var(--ops-muted)]"
                      }`}
                    >
                      {lead.status ?? "—"}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] ${urgency.className}`}>
                      {urgency.label}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    {lead.assigned_sales_agent_id ?? "—"}
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">{lead.area_target ?? "—"}</div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    <div className="flex flex-col gap-2">
                      {canWrite ? (
                        <>
                          {(lead.status === "lead_new" || lead.status === "invited") && (
                            <button
                              onClick={() => sendInvite(lead.id)}
                              className="rounded-lg border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-3 py-1 text-xs !text-white"
                            >
                              {lead.status === "invited" ? "Resend invite" : "Send invite"}
                            </button>
                          )}
                          {lead.status === "invited" && inviteToken && (
                            <button
                              onClick={() => copyInvite(lead.id)}
                              className="rounded-lg border border-[var(--ops-border)] bg-white px-3 py-1 text-xs text-slate-900 hover:bg-slate-50"
                            >
                              Copy invite
                            </button>
                          )}
                          {lead.status !== "lost" && (
                            <button
                              onClick={() => markLost(lead.id)}
                              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-200"
                            >
                              Mark lost
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-[10px] text-[var(--ops-muted)]">No actions</span>
                      )}
                      {inviteLinks[lead.id] && (
                        <span className="text-[10px] text-[var(--ops-muted)] break-all">
                          {inviteLinks[lead.id]}
                        </span>
                      )}
                      {actionState[lead.id] && (
                        <span className="text-[10px] text-[var(--ops-muted)]">
                          {actionState[lead.id]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
              })
            )}
          </div>
        </div>
      </div>
      {showNewLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-xl rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  New lead
                </p>
                <p className="mt-1 text-sm text-white">Capture the essentials and assign.</p>
              </div>
              <button
                onClick={() => {
                  setShowNewLead(false);
                  setFormError(null);
                  setFormStatus(null);
                }}
                className="rounded-lg border border-[var(--ops-border)] px-3 py-1 text-xs text-white"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Full name
                </label>
                <input
                  value={newLead.full_name}
                  onChange={(event) =>
                    setNewLead((prev) => ({ ...prev, full_name: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Email
                </label>
                <input
                  value={newLead.email}
                  onChange={(event) =>
                    setNewLead((prev) => ({ ...prev, email: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Phone
                </label>
                <input
                  value={newLead.phone}
                  onChange={(event) =>
                    setNewLead((prev) => ({ ...prev, phone: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Area target
                </label>
                <input
                  value={newLead.area_target}
                  onChange={(event) =>
                    setNewLead((prev) => ({ ...prev, area_target: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Commission plan
                </label>
                <input
                  value={newLead.commission_plan}
                  onChange={(event) =>
                    setNewLead((prev) => ({ ...prev, commission_plan: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Assign to
                </label>
                <select
                  value={newLead.assigned_sales_agent_id}
                  onChange={(event) =>
                    setNewLead((prev) => ({
                      ...prev,
                      assigned_sales_agent_id: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">Unassigned</option>
                  {staffOptions.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.user_id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {formError && <p className="mt-3 text-sm text-rose-200">{formError}</p>}
            {formStatus && <p className="mt-3 text-xs text-[var(--ops-muted)]">{formStatus}</p>}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowNewLead(false);
                  setFormError(null);
                  setFormStatus(null);
                }}
                className="rounded-xl border border-[var(--ops-border)] px-4 py-2 text-sm text-white"
              >
                Cancel
              </button>
              <button
                onClick={createLead}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200"
              >
                Create lead
              </button>
            </div>
          </div>
        </div>
      )}
    </OpsLayout>
  );
}
