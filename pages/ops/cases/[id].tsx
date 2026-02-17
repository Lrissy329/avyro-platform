import type { GetServerSideProps } from "next";
import { useState } from "react";
import Link from "next/link";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { hasOpsPermission, type OpsRole } from "@/lib/opsRbac";

type CaseDetail = {
  id: string;
  status: string | null;
  priority: string | null;
  assigned_to: string | null;
  booking_id: string | null;
  guest_id: string | null;
  host_id: string | null;
  listing_id: string | null;
  subject: string | null;
  last_activity_at: string | null;
  created_at: string | null;
};

type CaseNote = {
  id: string;
  note: string;
  created_at: string;
  staff_user_id: string;
};

type AuditEntry = {
  id: string;
  action: string;
  payload: any;
  created_at: string;
  actor_staff_user_id: string | null;
};

type PageProps = {
  caseRow: CaseDetail;
  notes: CaseNote[];
  audit: AuditEntry[];
  staffRole: OpsRole;
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

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:cases:read" });
  if ("redirect" in guard) return guard;

  const id = ctx.params?.id as string;
  const admin = getSupabaseServerClient();

  const { data: caseRow } = await admin
    .from("cases")
    .select(
      "id, status, priority, assigned_to, booking_id, guest_id, host_id, listing_id, subject, last_activity_at, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!caseRow) {
    return { notFound: true };
  }

  const { data: notes } = await admin
    .from("case_notes")
    .select("id, note, created_at, staff_user_id")
    .eq("case_id", id)
    .order("created_at", { ascending: false });

  const { data: audit } = await admin
    .from("audit_log")
    .select("id, action, payload, created_at, actor_staff_user_id")
    .eq("entity_type", "case")
    .eq("entity_id", id)
    .order("created_at", { ascending: false });

  return {
    props: {
      caseRow: caseRow as CaseDetail,
      notes: (notes ?? []) as CaseNote[],
      audit: (audit ?? []) as AuditEntry[],
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsCaseDetail({ caseRow, notes, audit, staffRole }: PageProps) {
  const role = staffRole as OpsRole;
  const canWrite = hasOpsPermission(role, "ops:cases:write");
  const [noteText, setNoteText] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const addNote = async () => {
    setStatusMessage("Saving...");
    try {
      const resp = await fetch(`/api/ops/cases/${caseRow.id}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Failed to add note");
      window.location.reload();
    } catch (err: any) {
      setStatusMessage(err?.message ?? "Failed to add note");
    }
  };

  return (
    <OpsLayout title="Case detail" role={staffRole}>
      <div className="grid gap-6 lg:grid-cols-[2.4fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Case</p>
            <h1 className="mt-2 text-lg font-semibold text-white">{caseRow.id}</h1>
            <p className="mt-2 text-sm text-[var(--ops-muted)]">{caseRow.subject}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Status
                </p>
                <p className="mt-2 text-sm text-white">{caseRow.status ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Priority
                </p>
                <p className="mt-2 text-sm text-white">{caseRow.priority ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Assigned to
                </p>
                <p className="mt-2 text-sm text-white">{caseRow.assigned_to ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Last activity
                </p>
                <p className="mt-2 text-sm text-white">
                  {formatDateTime(caseRow.last_activity_at)}
                </p>
              </div>
            </div>
            <div className="mt-4 text-xs text-[var(--ops-muted)]">
              Booking: {caseRow.booking_id ?? "—"} · Guest: {caseRow.guest_id ?? "—"} · Host:{" "}
              {caseRow.host_id ?? "—"} · Listing: {caseRow.listing_id ?? "—"}
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
                {statusMessage && (
                  <p className="mt-2 text-xs text-[var(--ops-muted)]">{statusMessage}</p>
                )}
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
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Links</p>
            <div className="mt-4 space-y-3 text-sm text-[var(--ops-muted)]">
              {caseRow.booking_id && (
                <Link href={`/ops/bookings/${caseRow.booking_id}`} className="block text-white">
                  View booking
                </Link>
              )}
              {caseRow.listing_id && (
                <Link href={`/ops/listings?listingId=${caseRow.listing_id}`} className="block text-white">
                  View listing
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
