import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

type VerificationRow = {
  user_id: string;
  work_email: string | null;
  document_type: string | null;
  document_url: string | null;
  status: string | null;
  reviewed_at: string | null;
  created_at: string | null;
};

type PageProps = {
  rows: VerificationRow[];
  query: {
    status: string;
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
  const guard = await requireOpsStaff(ctx, { permission: "ops:verification:read" });
  if ("redirect" in guard) return guard;

  const status = typeof ctx.query.status === "string" ? ctx.query.status.trim() : "";

  const admin = getSupabaseServerClient();
  let query = admin
    .from("guest_verifications")
    .select("user_id, work_email, document_type, document_url, status, reviewed_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) {
    query = query.eq("status", status);
  }

  const { data } = await query;

  return {
    props: {
      rows: data ?? [],
      query: { status },
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsVerification({ rows, query, staffRole }: PageProps) {
  return (
    <OpsLayout
      title="Verification"
      role={staffRole}
      kpis={[
        {
          label: "Pending",
          count: rows.filter((r) => r.status === "pending").length,
          href: "/ops/verification?status=pending",
          variant: "warning",
        },
        {
          label: "Approved",
          count: rows.filter((r) => r.status === "approved").length,
          href: "/ops/verification?status=approved",
          variant: "success",
        },
        {
          label: "Rejected",
          count: rows.filter((r) => r.status === "rejected").length,
          href: "/ops/verification?status=rejected",
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
              Status
            </label>
            <select
              name="status"
              defaultValue={query.status}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
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
          <div className="grid grid-cols-[1.3fr_0.8fr_0.8fr_0.6fr_0.6fr] gap-3 border-b border-[var(--ops-border)] px-4 py-3 text-xs uppercase tracking-[0.28em] text-[var(--ops-muted)]">
            <span>User</span>
            <span>Document</span>
            <span>Status</span>
            <span>Submitted</span>
            <span>Reviewed</span>
          </div>
          <div className="divide-y divide-[var(--ops-border)]">
            {rows.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[var(--ops-muted)]">No submissions found.</div>
            ) : (
              rows.map((row) => (
                <Link
                  key={row.user_id}
                  href={`/ops/verification/${row.user_id}`}
                  className="grid grid-cols-[1.3fr_0.8fr_0.8fr_0.6fr_0.6fr] gap-3 px-4 py-3 text-sm transition hover:bg-slate-50"
                >
                  <div className="text-white">{row.user_id}</div>
                  <div className="text-xs text-[var(--ops-muted)]">{row.document_type ?? "—"}</div>
                  <div className="text-xs text-[var(--ops-muted)]">{row.status ?? "—"}</div>
                  <div className="text-xs text-[var(--ops-muted)]">{formatDate(row.created_at)}</div>
                  <div className="text-xs text-[var(--ops-muted)]">{formatDate(row.reviewed_at)}</div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
