import type { GetServerSideProps } from "next";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

type UserRow = {
  id: string;
  email: string | null;
  created_at: string | null;
};

type PageProps = {
  users: UserRow[];
  staffRole: OpsRole;
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:users:read" });
  if ("redirect" in guard) return guard;

  const admin = getSupabaseServerClient();
  const { data } = await admin.from("profiles").select("id, email, created_at").limit(200);

  return {
    props: {
      users: data ?? [],
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsUsers({ users, staffRole }: PageProps) {
  return (
    <OpsLayout title="Users" role={staffRole}>
      <div className="overflow-hidden rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)]">
        <div className="grid grid-cols-[1.2fr_1fr_0.6fr] gap-3 border-b border-[var(--ops-border)] px-4 py-3 text-xs uppercase tracking-[0.28em] text-[var(--ops-muted)]">
          <span>User</span>
          <span>Email</span>
          <span>Created</span>
        </div>
        <div className="divide-y divide-[var(--ops-border)]">
          {users.length === 0 ? (
            <div className="px-4 py-8 text-sm text-[var(--ops-muted)]">No users found.</div>
          ) : (
            users.map((user) => (
              <div
                key={user.id}
                className="grid grid-cols-[1.2fr_1fr_0.6fr] gap-3 px-4 py-3 text-sm"
              >
                <div className="text-white">{user.id}</div>
                <div className="text-xs text-[var(--ops-muted)]">{user.email ?? "—"}</div>
                <div className="text-xs text-[var(--ops-muted)]">{formatDate(user.created_at)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </OpsLayout>
  );
}
