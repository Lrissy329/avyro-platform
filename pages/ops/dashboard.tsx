import type { GetServerSideProps } from "next";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsRole } from "@/lib/opsRbac";

type PageProps = {
  staffRole: OpsRole;
  metrics: {
    revenue30d: number;
    supplyCount: number;
    needsReviewCount: number;
    feedbackCount: number;
  };
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:dashboard:ops" });
  if ("redirect" in guard) return guard;

  const admin = getSupabaseServerClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: bookings },
    { count: listingsCount },
    { count: needsReviewCount },
    { count: feedbackCount },
  ] = await Promise.all([
    admin
      .from("bookings")
      .select("price_total, status, check_out_time")
      .gte("check_out_time", since)
      .limit(500),
    admin.from("listings").select("id", { count: "exact", head: true }),
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("needs_review", true),
    admin.from("reviews").select("id", { count: "exact", head: true }),
  ]);

  const revenue30d = (bookings ?? []).reduce((sum, row: any) => {
    if (row?.status !== "confirmed") return sum;
    const value = Number(row?.price_total ?? 0);
    if (!Number.isFinite(value)) return sum;
    return sum + value;
  }, 0);

  return {
    props: {
      staffRole: guard.staff.role as OpsRole,
      metrics: {
        revenue30d,
        supplyCount: listingsCount ?? 0,
        needsReviewCount: needsReviewCount ?? 0,
        feedbackCount: feedbackCount ?? 0,
      },
    },
  };
};

export default function OpsDashboard({ staffRole, metrics }: PageProps) {
  return (
    <OpsLayout title="Ops dashboard" role={staffRole}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
            Revenue (30d)
          </p>
          <p className="mt-2 text-2xl font-semibold text-white">£{Math.round(metrics.revenue30d)}</p>
        </div>
        <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
            Supply
          </p>
          <p className="mt-2 text-2xl font-semibold text-white">{metrics.supplyCount}</p>
        </div>
        <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
            Risk flags
          </p>
          <p className="mt-2 text-2xl font-semibold text-white">{metrics.needsReviewCount}</p>
        </div>
        <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
            Feedback
          </p>
          <p className="mt-2 text-2xl font-semibold text-white">{metrics.feedbackCount}</p>
        </div>
      </div>
    </OpsLayout>
  );
}
