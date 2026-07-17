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
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

type CaseRow = {
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

type StaffRow = {
  user_id: string;
  role: string;
  active: boolean;
};

type PageProps = {
  cases: CaseRow[];
  staff: StaffRow[];
  warnings: string[];
  query: {
    q: string;
    status: string;
    priority: string;
    assignee: string;
  };
  staffRole: OpsRole;
  casesAvailable: boolean;
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

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isMissingRelation = (error: any, relation: string) => {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42p01" && message.includes("relation") && message.includes(relation.toLowerCase());
};

const formatLabel = (value?: string | null) => {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
};

const statusTone = (value?: string | null) => {
  const status = String(value ?? "").toLowerCase();
  if (["open", "pending"].includes(status)) return "warning" as const;
  if (["resolved", "closed"].includes(status)) return "success" as const;
  return "default" as const;
};

const priorityTone = (value?: string | null) => {
  const priority = String(value ?? "").toLowerCase();
  if (["urgent", "high"].includes(priority)) return "danger" as const;
  if (priority === "normal") return "warning" as const;
  return "default" as const;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:cases:read" });
  if ("redirect" in guard) return guard;

  const q = typeof ctx.query.q === "string" ? ctx.query.q.trim() : "";
  const status = typeof ctx.query.status === "string" ? ctx.query.status.trim() : "";
  const priority = typeof ctx.query.priority === "string" ? ctx.query.priority.trim() : "";
  const assignee = typeof ctx.query.assignee === "string" ? ctx.query.assignee.trim() : "";
  const warnings: string[] = [];

  const admin = getSupabaseServerClient();
  let query = admin
    .from("cases")
    .select(
      "id, status, priority, assigned_to, booking_id, guest_id, host_id, listing_id, subject, last_activity_at, created_at"
    )
    .order("last_activity_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);
  if (priority) query = query.eq("priority", priority);
  if (assignee) query = query.eq("assigned_to", assignee);

  if (q) {
    if (isUuid(q)) {
      query = query.or(`id.eq.${q},booking_id.eq.${q},guest_id.eq.${q},host_id.eq.${q},listing_id.eq.${q}`);
    } else {
      query = query.ilike("subject", `%${q}%`);
    }
  }

  const [{ data: cases, error: casesError }, { data: staff }] = await Promise.all([
    query,
    admin.from("staff_users").select("user_id, role, active").order("user_id", { ascending: true }),
  ]);

  const casesAvailable = !isMissingRelation(casesError, "public.cases");
  if (!casesAvailable) {
    warnings.push("Cases schema is not installed in this environment yet. Case management is unavailable.");
  }

  return {
    props: {
      cases: casesAvailable ? cases ?? [] : [],
      staff: staff ?? [],
      warnings,
      query: { q, status, priority, assignee },
      staffRole: guard.staff.role,
      casesAvailable,
    },
  };
};

export default function OpsCases({
  cases,
  staff,
  warnings,
  query,
  staffRole,
  casesAvailable,
}: PageProps) {
  const openCount = cases.filter((item) => item.status === "open").length;
  const highPriorityCount = cases.filter((item) => ["high", "urgent"].includes(String(item.priority ?? "").toLowerCase())).length;
  const assignedCount = cases.filter((item) => item.assigned_to).length;

  return (
    <OpsLayout title="Cases" role={staffRole}>
      <div className="space-y-6">
        <OpsPageHeader
          title="Cases"
          description="Support and incident queue for operational follow-up."
        />

        {!casesAvailable ? (
          <div className="rounded-[18px] border border-slate-200 bg-white p-5">
            <OpsEmptyState
              title="Cases are not available in this environment."
              detail="The required cases schema migration has not been applied yet. The rest of the ops console remains available."
            />
            {warnings.length > 0 ? (
              <p className="mt-3 text-sm text-slate-500">{warnings[0]}</p>
            ) : null}
          </div>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <OpsMetric
                label="Open"
                value={String(openCount)}
                detail="Cases actively waiting for a response."
                href="/ops/cases?status=open"
                tone="warning"
                statusLabel={openCount > 0 ? "Queue" : undefined}
              />
              <OpsMetric
                label="High priority"
                value={String(highPriorityCount)}
                detail="Urgent or high-priority cases."
                href="/ops/cases?priority=high"
                tone={highPriorityCount > 0 ? "danger" : "default"}
                statusLabel={highPriorityCount > 0 ? "Critical" : undefined}
              />
              <OpsMetric
                label="Assigned"
                value={String(assignedCount)}
                detail="Cases already owned by a staff member."
                href="/ops/cases"
                tone="info"
                statusLabel={assignedCount > 0 ? "In progress" : undefined}
              />
            </section>

            <OpsFilterBar>
              <div className="min-w-[260px] flex-1">
                <label className="mb-2 block text-sm font-medium text-slate-700">Search</label>
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
                  <input
                    name="q"
                    defaultValue={query.q}
                    placeholder="Search case, subject, booking or listing"
                    className="min-w-0 flex-1 border-0 bg-transparent px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Search
                  </button>
                </div>
              </div>

              <div className="min-w-[160px]">
                <label className="mb-2 block text-sm font-medium text-slate-700">Status</label>
                <select
                  name="status"
                  defaultValue={query.status}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
                >
                  <option value="">All statuses</option>
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div className="min-w-[160px]">
                <label className="mb-2 block text-sm font-medium text-slate-700">Priority</label>
                <select
                  name="priority"
                  defaultValue={query.priority}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
                >
                  <option value="">All priorities</option>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div className="min-w-[220px]">
                <label className="mb-2 block text-sm font-medium text-slate-700">Assignee</label>
                <select
                  name="assignee"
                  defaultValue={query.assignee}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
                >
                  <option value="">All staff</option>
                  {staff.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.user_id.slice(0, 8)} · {formatLabel(member.role)}
                    </option>
                  ))}
                </select>
              </div>
            </OpsFilterBar>

            <OpsTable
              gridClassName="grid grid-cols-[1.1fr_1.4fr_0.9fr_0.8fr_0.9fr_0.8fr]"
              columns={["Case", "Subject", "Status", "Priority", "Assignee", "Updated"]}
            >
              {cases.length === 0 ? (
                <div className="px-4 py-8">
                  <OpsEmptyState title="No cases found for these filters." />
                </div>
              ) : (
                cases.map((item) => (
                  <Link
                    key={item.id}
                    href={`/ops/cases/${item.id}`}
                    className="grid grid-cols-[1.1fr_1.4fr_0.9fr_0.8fr_0.9fr_0.8fr] gap-3 px-4 py-3.5 text-sm transition hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-950">Case {item.id.slice(0, 8)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.booking_id ? `Booking ${item.booking_id.slice(0, 8)}` : "No booking linked"}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-900">{item.subject ?? "No subject"}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.listing_id ? `Listing ${item.listing_id.slice(0, 8)}` : "No listing linked"}
                      </p>
                    </div>

                    <div>
                      <OpsStatusBadge label={formatLabel(item.status)} tone={statusTone(item.status)} />
                    </div>

                    <div>
                      <OpsStatusBadge label={formatLabel(item.priority)} tone={priorityTone(item.priority)} />
                    </div>

                    <div className="text-sm text-slate-600">
                      {item.assigned_to ? `${item.assigned_to.slice(0, 8)}` : "Unassigned"}
                    </div>

                    <div className="text-sm text-slate-600">{formatDate(item.last_activity_at)}</div>
                  </Link>
                ))
              )}
            </OpsTable>
          </>
        )}
      </div>
    </OpsLayout>
  );
}
