import type { GetServerSideProps } from "next";
import { useState } from "react";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { hasOpsPermission, type OpsRole } from "@/lib/opsRbac";

type VerificationDetail = {
  user_id: string;
  work_email: string | null;
  document_type: string | null;
  document_url: string | null;
  status: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string | null;
};

type PageProps = {
  row: VerificationDetail;
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
  const guard = await requireOpsStaff(ctx, { permission: "ops:verification:read" });
  if ("redirect" in guard) return guard;

  const id = ctx.params?.id as string;
  const admin = getSupabaseServerClient();
  const { data } = await admin
    .from("guest_verifications")
    .select("user_id, work_email, document_type, document_url, status, review_notes, reviewed_at, created_at")
    .eq("user_id", id)
    .maybeSingle();

  if (!data) return { notFound: true };

  return {
    props: {
      row: data as VerificationDetail,
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsVerificationDetail({ row, staffRole }: PageProps) {
  const role = staffRole as OpsRole;
  const canReview = hasOpsPermission(role, "ops:verification:write");
  const [notes, setNotes] = useState(row.review_notes ?? "");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const act = async (status: "approved" | "rejected") => {
    setStatusMessage("Working...");
    try {
      const resp = await fetch(`/api/ops/verification/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.user_id, status, reviewNotes: notes }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Action failed");
      window.location.reload();
    } catch (err: any) {
      setStatusMessage(err?.message ?? "Action failed");
    }
  };

  return (
    <OpsLayout title="Verification detail" role={staffRole}>
      <div className="grid gap-6 lg:grid-cols-[2.4fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">User</p>
            <h1 className="mt-2 text-lg font-semibold text-white">{row.user_id}</h1>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Status
                </p>
                <p className="mt-2 text-sm text-white">{row.status ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Document
                </p>
                <p className="mt-2 text-sm text-white">{row.document_type ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Work email
                </p>
                <p className="mt-2 text-sm text-white">{row.work_email ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Submitted
                </p>
                <p className="mt-2 text-sm text-white">{formatDateTime(row.created_at)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Document</p>
            <div className="mt-4 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
              {row.document_url ? (
                <a href={row.document_url} target="_blank" rel="noreferrer" className="text-white underline">
                  View document
                </a>
              ) : (
                <p className="text-sm text-[var(--ops-muted)]">No document uploaded.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Review</p>
            {canReview ? (
              <>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="mt-3 min-h-[120px] w-full rounded-xl border border-[var(--ops-border)] bg-white p-3 text-sm text-slate-900"
                  placeholder="Internal review notes"
                />
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    onClick={() => act("approved")}
                    className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => act("rejected")}
                    className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
                  >
                    Reject
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-[var(--ops-muted)]">
                You do not have permission to review documents.
              </p>
            )}
            {statusMessage && <p className="mt-2 text-xs text-[var(--ops-muted)]">{statusMessage}</p>}
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
