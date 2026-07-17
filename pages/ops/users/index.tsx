import type { GetServerSideProps } from "next";
import OpsEmptyState from "@/components/ops/OpsEmptyState";
import OpsErrorPanel from "@/components/ops/OpsErrorPanel";
import OpsFilterBar from "@/components/ops/OpsFilterBar";
import OpsLayout from "@/components/ops/OpsLayout";
import OpsPageHeader from "@/components/ops/OpsPageHeader";
import OpsSearchBar from "@/components/ops/OpsSearchBar";
import OpsStatusBadge from "@/components/ops/OpsStatusBadge";
import OpsTable from "@/components/ops/OpsTable";
import { requireOpsStaff } from "@/lib/opsAuth";
import type { OpsRole } from "@/lib/opsRbac";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type UserRow = {
  id: string;
  full_name?: string | null;
  email: string | null;
  verification_level?: number | null;
  verification_status?: string | null;
  stripe_account_id?: string | null;
  stripe_onboarding_status?: string | null;
  primary_role?: string | null;
  active_role?: string | null;
  created_at: string | null;
};

type BookingSummaryRow = {
  guest_id: string | null;
  host_id: string | null;
};

type ListingSummaryRow = {
  user_id: string | null;
};

type UserCounts = {
  guestBookings: number;
  hostedBookings: number;
  listings: number;
};

type PageProps = {
  users: Array<UserRow & { counts: UserCounts }>;
  staffRole: OpsRole;
  errors: string[];
  query: {
    q: string;
    role: string;
  };
};

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const formatRole = (value?: string | null) => {
  if (!value) return "No role";
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
};

const verificationLabel = (user: UserRow) => {
  const raw = String(user.verification_status ?? "").toLowerCase();
  const level = Number(user.verification_level ?? 0) || 0;
  if (raw === "rejected") return { label: "Verification rejected", tone: "danger" as const };
  if (raw === "pending") return { label: "Verification pending", tone: "warning" as const };
  if (level >= 2) return { label: "Document reviewed", tone: "success" as const };
  if (level >= 1) return { label: "Work email verified", tone: "info" as const };
  return { label: "No verification yet", tone: "default" as const };
};

const hostStatusLabel = (user: UserRow, counts: UserCounts) => {
  const onboarding = String(user.stripe_onboarding_status ?? "").toLowerCase();
  if (user.stripe_account_id && onboarding === "complete") {
    return { label: "Stripe connected", tone: "success" as const };
  }
  if (user.stripe_account_id) {
    return { label: "Stripe setup in progress", tone: "warning" as const };
  }
  if (counts.listings > 0) {
    return { label: "Host setup incomplete", tone: "warning" as const };
  }
  return { label: "Guest account", tone: "default" as const };
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:users:read" });
  if ("redirect" in guard) return guard;

  const admin = getSupabaseServerClient();
  const errors: string[] = [];
  const q = typeof ctx.query.q === "string" ? ctx.query.q.trim().toLowerCase() : "";
  const role = typeof ctx.query.role === "string" ? ctx.query.role.trim().toLowerCase() : "";

  const selects = [
    "id, full_name, email, verification_level, verification_status, stripe_account_id, stripe_onboarding_status, primary_role, active_role, created_at",
    "id, full_name, email, verification_level, verification_status, stripe_account_id, stripe_onboarding_status, created_at",
    "id, full_name, email, verification_level, verification_status, created_at",
    "id, email, created_at",
  ];

  let users: UserRow[] = [];
  for (const select of selects) {
    const { data, error } = await admin
      .from("profiles")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(200);

    users = (data as unknown as UserRow[]) ?? [];
    if (!error) break;
    if (!isMissingColumn(error)) {
      errors.push(`Users could not be loaded: ${error.message}`);
      users = [];
      break;
    }
  }

  const userIds = users.map((user) => user.id);
  const [bookingsRes, listingsRes] = await Promise.all([
    userIds.length > 0
      ? admin.from("bookings").select("guest_id, host_id").or(`guest_id.in.(${userIds.join(",")}),host_id.in.(${userIds.join(",")})`)
      : Promise.resolve({ data: [], error: null } as any),
    userIds.length > 0
      ? admin.from("listings").select("user_id").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (bookingsRes.error) {
    errors.push(`Booking counts could not be loaded: ${bookingsRes.error.message}`);
  }
  if (listingsRes.error) {
    errors.push(`Listing counts could not be loaded: ${listingsRes.error.message}`);
  }

  const countsMap = new Map<string, UserCounts>();
  userIds.forEach((id) => {
    countsMap.set(id, { guestBookings: 0, hostedBookings: 0, listings: 0 });
  });

  ((bookingsRes.data ?? []) as BookingSummaryRow[]).forEach((row) => {
    if (row.guest_id && countsMap.has(row.guest_id)) {
      countsMap.get(row.guest_id)!.guestBookings += 1;
    }
    if (row.host_id && countsMap.has(row.host_id)) {
      countsMap.get(row.host_id)!.hostedBookings += 1;
    }
  });

  ((listingsRes.data ?? []) as ListingSummaryRow[]).forEach((row) => {
    if (row.user_id && countsMap.has(row.user_id)) {
      countsMap.get(row.user_id)!.listings += 1;
    }
  });

  const filteredUsers = users
    .map((user) => ({
      ...user,
      counts: countsMap.get(user.id) ?? { guestBookings: 0, hostedBookings: 0, listings: 0 },
    }))
    .filter((user) => {
      const haystack = [
        user.id,
        user.full_name ?? "",
        user.email ?? "",
        user.primary_role ?? "",
        user.active_role ?? "",
      ]
        .join(" ")
        .toLowerCase();

      const roleMatch =
        !role ||
        String(user.primary_role ?? "").toLowerCase() === role ||
        String(user.active_role ?? "").toLowerCase() === role;
      const queryMatch = !q || haystack.includes(q);

      return roleMatch && queryMatch;
    });

  return {
    props: {
      users: filteredUsers,
      staffRole: guard.staff.role,
      errors,
      query: { q, role },
    },
  };
};

export default function OpsUsers({ users, staffRole, errors, query }: PageProps) {
  return (
    <OpsLayout title="Users" role={staffRole}>
      <div className="space-y-6">
        <OpsPageHeader
          title="Users"
          description="People directory for guest, host, and verification state."
        />

        <OpsErrorPanel messages={errors} />

        <OpsFilterBar>
          <div className="min-w-[280px] flex-1">
            <label className="mb-2 block text-sm font-medium text-slate-700">Search</label>
            <OpsSearchBar defaultValue={query.q} placeholder="Search user, email or role" />
          </div>

          <div className="min-w-[180px]">
            <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
            <select
              name="role"
              defaultValue={query.role}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
            >
              <option value="">All roles</option>
              <option value="host">Host</option>
              <option value="guest">Guest</option>
            </select>
          </div>
        </OpsFilterBar>

        <OpsTable
          gridClassName="grid grid-cols-[1.45fr_0.9fr_1fr_1fr_0.9fr_0.8fr]"
          columns={["User", "Role", "Verification", "Host status", "Bookings / listings", "Joined"]}
        >
          {users.length === 0 ? (
            <div className="px-4 py-8">
              <OpsEmptyState title="No users found." detail="When guests and hosts sign up, they will appear here." />
            </div>
          ) : (
            users.map((user) => {
              const verification = verificationLabel(user);
              const hostStatus = hostStatusLabel(user, user.counts);
              const name = user.full_name?.trim() || user.email || "Unknown user";

              return (
                <div
                  key={user.id}
                  className="grid grid-cols-[1.45fr_0.9fr_1fr_1fr_0.9fr_0.8fr] gap-3 px-4 py-3.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">{name}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">{user.email ?? "No email on profile"}</p>
                    <p className="mt-1 text-xs text-slate-500">User {user.id.slice(0, 8)}</p>
                  </div>

                  <div className="text-sm text-slate-700">
                    <p>{formatRole(user.active_role || user.primary_role)}</p>
                    {user.active_role && user.primary_role && user.active_role !== user.primary_role ? (
                      <p className="mt-1 text-xs text-slate-500">Primary {formatRole(user.primary_role)}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <OpsStatusBadge label={verification.label} tone={verification.tone} />
                    <p className="text-xs text-slate-500">
                      Level {Number(user.verification_level ?? 0) || 0}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <OpsStatusBadge label={hostStatus.label} tone={hostStatus.tone} />
                    <p className="text-xs text-slate-500">
                      {user.counts.listings > 0
                        ? `${user.counts.listings} listing${user.counts.listings === 1 ? "" : "s"}`
                        : "No listings yet"}
                    </p>
                  </div>

                  <div className="text-sm text-slate-700">
                    <p>{user.counts.guestBookings} guest bookings</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {user.counts.hostedBookings} hosted booking{user.counts.hostedBookings === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="text-sm text-slate-600">{formatDate(user.created_at)}</div>
                </div>
              );
            })
          )}
        </OpsTable>
      </div>
    </OpsLayout>
  );
}
