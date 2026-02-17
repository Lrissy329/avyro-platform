import type { GetServerSideProps } from "next";
import Link from "next/link";
import OpsLayout from "@/components/ops/OpsLayout";
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
  query: {
    q: string;
    status: string;
    priority: string;
    assignee: string;
  };
  staffRole: OpsRole;
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:cases:read" });
  if ("redirect" in guard) return guard;

  const q = typeof ctx.query.q === "string" ? ctx.query.q.trim() : "";
  const status = typeof ctx.query.status === "string" ? ctx.query.status.trim() : "";
  const priority = typeof ctx.query.priority === "string" ? ctx.query.priority.trim() : "";
  const assignee = typeof ctx.query.assignee === "string" ? ctx.query.assignee.trim() : "";

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
      query = query.or(
        `id.eq.${q},booking_id.eq.${q},guest_id.eq.${q},host_id.eq.${q},listing_id.eq.${q}`
      );
    } else {
      query = query.ilike("subject", `%${q}%`);
    }
  }

  const [{ data: cases }, { data: staff }] = await Promise.all([
    query,
    admin.from("staff_users").select("user_id, role, active").order("user_id", {
      ascending: true,
    }),
  ]);

  return {
    props: {
      cases: cases ?? [],
      staff: staff ?? [],
      query: { q, status, priority, assignee },
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsCases({ cases, staff, query, staffRole }: PageProps) {
  return (
    <OpsLayout
      title="Cases"
      role={staffRole}
      kpis={[
        {
          label: "Open",
          count: cases.filter((c) => c.status === "open").length,
          href: "/ops/cases?status=open",
          variant: "warning",
        },
        {
          label: "High",
          count: cases.filter((c) => c.priority === "high").length,
          href: "/ops/cases?priority=high",
          variant: "danger",
        },
        {
          label: "Assigned",
          count: cases.filter((c) => c.assigned_to).length,
          href: "/ops/cases",
          variant: "info",
        },
      ]}
    >
      <div className="space-y-4">
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
              placeholder="Case id / subject / booking"
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
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="flex min-w-[160px] flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Priority
            </label>
            <select
              name="priority"
              defaultValue={query.priority}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="flex min-w-[200px] flex-col">
            <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Assignee
            </label>
            <select
              name="assignee"
              defaultValue={query.assignee}
              className="mt-2 rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">All</option>
              {staff.map((member) => (
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
          <div className="grid grid-cols-[1.3fr_1.2fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-[var(--ops-border)] px-4 py-3 text-xs uppercase tracking-[0.28em] text-[var(--ops-muted)]">
            <span>Case</span>
            <span>Subject</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Last activity</span>
          </div>

          <div className="divide-y divide-[var(--ops-border)]">
            {cases.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[var(--ops-muted)]">
                No cases found for these filters.
              </div>
            ) : (
              cases.map((item) => (
                <Link
                  key={item.id}
                  href={`/ops/cases/${item.id}`}
                  className="grid grid-cols-[1.3fr_1.2fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3 text-sm transition hover:bg-slate-50"
                >
                  <div className="space-y-1">
                    <div className="font-semibold text-white">{item.id}</div>
                    <div className="text-xs text-[var(--ops-muted)]">
                      Booking: {item.booking_id ?? "—"}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--ops-muted)]">{item.subject ?? "—"}</div>
                  <div className="text-xs text-[var(--ops-muted)]">{item.status ?? "—"}</div>
                  <div className="text-xs text-[var(--ops-muted)]">{item.priority ?? "—"}</div>
                  <div className="text-xs text-[var(--ops-muted)]">
                    {formatDate(item.last_activity_at)}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
