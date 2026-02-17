import type { GetServerSideProps } from "next";
import { useState } from "react";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff, logOpsForbiddenAttempt } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { hasOpsPermission, type OpsRole } from "@/lib/opsRbac";

type LeadDetail = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  assigned_sales_agent_id: string | null;
  area_target: string | null;
  commission_plan: string | null;
  converted_host_user_id: string | null;
  created_at: string | null;
};

type LeadNote = {
  id: string;
  note: string;
  created_at: string;
  staff_user_id: string;
};

type InviteRow = {
  id: string;
  token: string;
  email: string | null;
  expires_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string | null;
};

type StaffRow = {
  user_id: string;
  role: string;
  active: boolean;
};

type AuditEntry = {
  id: string;
  action: string;
  payload: any;
  created_at: string;
  actor_staff_user_id: string | null;
};

type PageProps = {
  lead: LeadDetail;
  notes: LeadNote[];
  invites: InviteRow[];
  audit: AuditEntry[];
  staffRole: OpsRole;
  staffUserId: string;
  staff: StaffRow[];
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  const id = ctx.params?.id as string;
  const admin = getSupabaseServerClient();

  const { data: lead } = await admin
    .from("host_leads")
    .select(
      "id, full_name, email, phone, status, assigned_sales_agent_id, area_target, commission_plan, converted_host_user_id, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!lead) return { notFound: true };

  if (guard.staff.role === "sales_agent" && lead.assigned_sales_agent_id !== guard.staff.user_id) {
    await logOpsForbiddenAttempt({
      userId: guard.session.user.id,
      staffUserId: guard.staff.user_id,
      role: guard.staff.role as OpsRole,
      path: ctx.resolvedUrl,
      permission: "ops:sales:read",
      reason: "lead_not_assigned",
    });
    return {
      redirect: { destination: "/ops/denied", permanent: false },
    };
  }

  const [notesRes, invitesRes, auditRes, staffRes] = await Promise.all([
    admin
      .from("host_lead_notes")
      .select("id, note, created_at, staff_user_id")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("host_invites")
      .select("id, token, email, expires_at, claimed_by, claimed_at, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("audit_log")
      .select("id, action, payload, created_at, actor_staff_user_id")
      .eq("entity_type", "host_lead")
      .eq("entity_id", id)
      .order("created_at", { ascending: false }),
    admin.from("staff_users").select("user_id, role, active").order("user_id", {
      ascending: true,
    }),
  ]);

  return {
    props: {
      lead: lead as LeadDetail,
      notes: (notesRes.data ?? []) as LeadNote[],
      invites: (invitesRes.data ?? []) as InviteRow[],
      audit: (auditRes.data ?? []) as AuditEntry[],
      staffRole: guard.staff.role as OpsRole,
      staffUserId: guard.staff.user_id,
      staff: (staffRes.data ?? []) as StaffRow[],
    },
  };
};

export default function OpsSalesLeadDetail({
  lead,
  notes,
  invites,
  audit,
  staffRole,
  staffUserId,
  staff,
}: PageProps) {
  const [noteText, setNoteText] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState(lead.assigned_sales_agent_id ?? staffUserId);
  const canWrite = hasOpsPermission(staffRole, "ops:sales:write");
  const staffOptions = staff.filter((member) => {
    const eligible = member.role === "sales_agent" || member.role === "admin";
    if (!eligible) return false;
    if (staffRole !== "sales_agent") return true;
    return member.user_id === staffUserId;
  });

  const sendInvite = async () => {
    setStatusMessage("Sending invite...");
    try {
      const resp = await fetch("/api/ops/sales/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Invite failed");
      if (payload?.inviteUrl && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload.inviteUrl);
      }
      window.location.reload();
    } catch (err: any) {
      setStatusMessage(err?.message ?? "Invite failed");
    }
  };

  const addNote = async () => {
    setStatusMessage("Saving note...");
    try {
      const resp = await fetch(`/api/ops/sales/leads/${lead.id}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Note failed");
      window.location.reload();
    } catch (err: any) {
      setStatusMessage(err?.message ?? "Note failed");
    }
  };

  const updateAssignee = async () => {
    setStatusMessage("Updating assignee...");
    try {
      const resp = await fetch("/api/ops/sales/leads/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, assignedSalesAgentId: assignedTo }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Assign failed");
      window.location.reload();
    } catch (err: any) {
      setStatusMessage(err?.message ?? "Assign failed");
    }
  };

  const markLost = async () => {
    setStatusMessage("Marking lost...");
    try {
      const resp = await fetch("/api/ops/sales/leads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, status: "lost" }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Update failed");
      window.location.reload();
    } catch (err: any) {
      setStatusMessage(err?.message ?? "Update failed");
    }
  };

  return (
    <OpsLayout title="Lead detail" role={staffRole}>
      <div className="grid gap-6 lg:grid-cols-[2.4fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Lead</p>
            <h1 className="mt-2 text-lg font-semibold text-white">
              {lead.full_name ?? lead.email ?? lead.id}
            </h1>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Status</p>
                <span
                  className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                    STATUS_STYLES[lead.status ?? ""] ??
                    "border-[var(--ops-border)] text-[var(--ops-muted)]"
                  }`}
                >
                  {lead.status ?? "—"}
                </span>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Assignee</p>
                <p className="mt-2 text-sm text-white">{lead.assigned_sales_agent_id ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Area target</p>
                <p className="mt-2 text-sm text-white">{lead.area_target ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Commission plan</p>
                <p className="mt-2 text-sm text-white">{lead.commission_plan ?? "—"}</p>
              </div>
            </div>
            <div className="mt-4 text-xs text-[var(--ops-muted)]">
              Email: {lead.email ?? "—"} · Phone: {lead.phone ?? "—"} · Created{" "}
              {formatDateTime(lead.created_at)}
            </div>
            <div className="mt-2 text-xs text-[var(--ops-muted)]">
              Claimed user: {lead.converted_host_user_id ?? "Not claimed"}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--ops-muted)]">
              Invite history
            </h2>
            <div className="mt-4 space-y-3">
              {invites.length === 0 ? (
                <p className="text-sm text-[var(--ops-muted)]">No invites yet.</p>
              ) : (
                invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]"
                  >
                    <p className="text-white">Token: {invite.token}</p>
                    <div className="mt-2 text-xs text-[var(--ops-muted)]">
                      Sent {formatDateTime(invite.created_at)} · Expires{" "}
                      {formatDateTime(invite.expires_at)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ops-muted)]">
                      Claimed: {invite.claimed_by ?? "—"} {invite.claimed_at ? `(${formatDateTime(invite.claimed_at)})` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--ops-muted)]">
              Notes
            </h2>
            <div className="mt-4 space-y-3">
              {notes.length === 0 ? (
                <p className="text-sm text-[var(--ops-muted)]">No notes yet.</p>
              ) : (
                notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]"
                  >
                    <p className="text-white">{note.note}</p>
                    <div className="mt-2 text-xs text-[var(--ops-muted)]">
                      {note.staff_user_id} · {formatDateTime(note.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
            {canWrite ? (
              <div className="mt-4 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Add note
                </label>
                <textarea
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  className="mt-2 min-h-[120px] w-full rounded-xl border border-[var(--ops-border)] bg-white p-3 text-sm text-slate-900"
                />
                <button
                  onClick={addNote}
                  className="mt-3 rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
                >
                  Save note
                </button>
              </div>
            ) : (
              <p className="text-xs text-[var(--ops-muted)]">
                You do not have permission to add notes.
              </p>
            )}
          </div>

          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--ops-muted)]">
              Audit log
            </h2>
            <div className="mt-4 space-y-3">
              {audit.length === 0 ? (
                <p className="text-sm text-[var(--ops-muted)]">No audit entries.</p>
              ) : (
                audit.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]"
                  >
                    <p className="text-white">{entry.action}</p>
                    <div className="mt-2 text-xs text-[var(--ops-muted)]">
                      {entry.actor_staff_user_id ?? "System"} · {formatDateTime(entry.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Actions</p>
            {canWrite ? (
              <div className="mt-4 space-y-4">
                {(lead.status === "lead_new" || lead.status === "invited") && (
                  <button
                    onClick={sendInvite}
                    className="w-full rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
                  >
                    {lead.status === "invited" ? "Resend invite" : "Send invite"}
                  </button>
                )}

                <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                    Reassign
                  </p>
                  <select
                    value={assignedTo}
                    onChange={(event) => setAssignedTo(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {staffOptions.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.user_id}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={updateAssignee}
                    className="mt-3 w-full rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
                  >
                    Update assignee
                  </button>
                </div>

                {lead.status !== "lost" && (
                  <button
                    onClick={markLost}
                    className="w-full rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200"
                  >
                    Mark lost
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--ops-muted)]">No actions available.</p>
            )}
            {statusMessage && <p className="mt-3 text-xs text-[var(--ops-muted)]">{statusMessage}</p>}
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
