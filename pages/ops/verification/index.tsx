import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsEmptyState from "@/components/ops/OpsEmptyState";
import OpsFilterBar from "@/components/ops/OpsFilterBar";
import OpsLayout from "@/components/ops/OpsLayout";
import OpsMetric from "@/components/ops/OpsMetric";
import OpsPageHeader from "@/components/ops/OpsPageHeader";
import OpsStatusBadge from "@/components/ops/OpsStatusBadge";
import OpsTable from "@/components/ops/OpsTable";
import { requireOpsStaff } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type VerificationRow = {
  user_id: string;
  work_email: string | null;
  document_type: string | null;
  document_url: string | null;
  status: string | null;
  reviewed_at: string | null;
  created_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type EnrichedVerificationRow = VerificationRow & {
  profile: ProfileRow | null;
};

type PageProps = {
  rows: EnrichedVerificationRow[];
  query: {
    status: string;
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

const formatAge = (value?: string | null) => {
  if (!value) return "Age unknown";
  const createdAt = new Date(value);
  if (!Number.isFinite(createdAt.getTime())) return "Age unknown";
  const diffDays = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "1 day old";
  return `${diffDays} days old`;
};

const formatStatus = (value?: string | null) => {
  const status = String(value ?? "").toLowerCase();
  if (status === "approved") return { label: "Approved", tone: "success" as const };
  if (status === "rejected") return { label: "Rejected", tone: "danger" as const };
  if (status === "pending") return { label: "Pending", tone: "warning" as const };
  return { label: "Unknown", tone: "default" as const };
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
  const verificationRows = (data ?? []) as VerificationRow[];
  const userIds = Array.from(new Set(verificationRows.map((row) => row.user_id)));

  const profileRes =
    userIds.length > 0
      ? await admin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
  const profileMap = new Map(((profileRes.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));

  return {
    props: {
      rows: verificationRows.map((row) => ({
        ...row,
        profile: profileMap.get(row.user_id) ?? null,
      })),
      query: { status },
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsVerification({ rows, query, staffRole }: PageProps) {
  const pendingCount = rows.filter((row) => row.status === "pending").length;
  const approvedCount = rows.filter((row) => row.status === "approved").length;
  const rejectedCount = rows.filter((row) => row.status === "rejected").length;

  return (
    <OpsLayout title="Verification" role={staffRole}>
      <div className="space-y-6">
        <OpsPageHeader
          title="Verification"
          description="Work queue for guest checks, documents, and approval state."
        />

        <section className="grid gap-3 md:grid-cols-3">
          <OpsMetric
            label="Pending"
            value={String(pendingCount)}
            detail="Requests waiting for staff review."
            href="/ops/verification?status=pending"
            tone="warning"
            statusLabel={pendingCount > 0 ? "Queue" : undefined}
          />
          <OpsMetric
            label="Approved"
            value={String(approvedCount)}
            detail="Requests already approved."
            href="/ops/verification?status=approved"
            tone="success"
            statusLabel={approvedCount > 0 ? "Healthy" : undefined}
          />
          <OpsMetric
            label="Rejected"
            value={String(rejectedCount)}
            detail="Requests rejected or sent back."
            href="/ops/verification?status=rejected"
            tone={rejectedCount > 0 ? "danger" : "default"}
            statusLabel={rejectedCount > 0 ? "Attention" : undefined}
          />
        </section>

        <OpsFilterBar>
          <div className="min-w-[220px]">
            <label className="mb-2 block text-sm font-medium text-slate-700">Status</label>
            <select
              name="status"
              defaultValue={query.status}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
            >
              <option value="">All requests</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
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
          gridClassName="grid grid-cols-[1.35fr_0.95fr_0.9fr_0.7fr_0.7fr]"
          columns={["Guest", "Verification", "Status", "Submitted", "Reviewed"]}
        >
          {rows.length === 0 ? (
            <div className="px-4 py-8">
              <OpsEmptyState title="No verification requests found." />
            </div>
          ) : (
            rows.map((row) => {
              const status = formatStatus(row.status);
              const guestName = row.profile?.full_name?.trim() || row.profile?.email || "Guest";
              const verificationType = row.document_type
                ? row.document_type.replace(/_/g, " ")
                : row.work_email
                  ? "Work email check"
                  : "Verification request";

              return (
                <Link
                  key={row.user_id}
                  href={`/ops/verification/${row.user_id}`}
                  className="grid grid-cols-[1.35fr_0.95fr_0.9fr_0.7fr_0.7fr] gap-3 px-4 py-3.5 text-sm transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">{guestName}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {row.profile?.email ?? row.work_email ?? "No email available"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Guest {row.user_id.slice(0, 8)}</p>
                  </div>

                  <div className="text-sm text-slate-700">
                    <p>{verificationType}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatAge(row.created_at)}</p>
                  </div>

                  <div className="space-y-2">
                    <OpsStatusBadge label={status.label} tone={status.tone} />
                    {row.document_url ? (
                      <p className="text-xs text-slate-500">Document uploaded</p>
                    ) : (
                      <p className="text-xs text-slate-500">No document link</p>
                    )}
                  </div>

                  <div className="text-sm text-slate-600">{formatDate(row.created_at)}</div>

                  <div className="text-sm text-slate-600">{formatDate(row.reviewed_at)}</div>
                </Link>
              );
            })
          )}
        </OpsTable>
      </div>
    </OpsLayout>
  );
}
