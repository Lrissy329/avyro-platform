import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";
import {
  BadgePoundSterling,
  BriefcaseBusiness,
  ChartColumnIncreasing,
  CircleUserRound,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  Map,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import type { OpsRole } from "@/lib/opsRbac";
import { getOpsNavItems } from "@/lib/opsRbac";

type OpsKpi = {
  label: string;
  count: number;
  href: string;
  variant?: "default" | "warning" | "danger" | "success" | "info";
};

type OpsLayoutProps = {
  title: string;
  children: ReactNode;
  kpis?: OpsKpi[];
  role?: OpsRole;
};

const KPI_STYLES: Record<string, string> = {
  default: "border-[var(--ops-border)] text-[var(--ops-muted)]",
  warning: "border-amber-500/40 text-amber-200",
  danger: "border-rose-500/40 text-rose-200",
  success: "border-emerald-500/40 text-emerald-200",
  info: "border-sky-500/40 text-sky-200",
};

const NAV_ICONS = {
  "/ops/dashboard": LayoutDashboard,
  "/ops/bookings": ListChecks,
  "/ops/listings": BriefcaseBusiness,
  "/ops/users": CircleUserRound,
  "/ops/verification": ShieldCheck,
  "/ops/payouts": CreditCard,
  "/ops/cases": Users,
  "/ops/heatmap": Map,
  "/ops/sales/dashboard": ChartColumnIncreasing,
  "/ops/sales/leads": Users,
  "/ops/sales/targets": Target,
} as const;

const formatRoleLabel = (role?: OpsRole) => {
  if (!role) return "Staff";
  return role.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
};

export default function OpsLayout({ title, children, kpis = [], role }: OpsLayoutProps) {
  const router = useRouter();
  const navItems = getOpsNavItems(role);
  const primaryNav = navItems.filter((item) => (item.priority ?? "primary") === "primary");
  const secondaryNav = navItems.filter((item) => item.priority === "secondary");

  return (
    <div data-theme="ops" className="min-h-screen bg-[var(--ops-bg)] text-[var(--ops-text)]">
      <div className="grid min-h-screen grid-cols-1 grid-rows-[auto_1fr] lg:grid-cols-[248px_1fr]">
        <aside className="row-span-2 hidden flex-col border-r border-slate-800 bg-[#0b1220] lg:flex">
          <div className="px-5 py-5">
            <div className="text-sm font-semibold text-white">Ops Console</div>
            <div className="mt-1 text-xs text-slate-400">Staff operations</div>
          </div>
          <nav className="flex-1 space-y-5 px-3 pb-6">
            <div className="space-y-1">
            {primaryNav.map((item) => {
              const isActive = router.pathname.startsWith(item.href);
              const Icon = NAV_ICONS[item.href as keyof typeof NAV_ICONS] ?? LayoutDashboard;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    isActive
                      ? "bg-white/8 text-white before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-[#f4c542] before:content-['']"
                      : "text-slate-400 hover:bg-white/6 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
            </div>
            {secondaryNav.length > 0 ? (
              <div className="space-y-1 border-t border-white/10 pt-4">
                <div className="px-3 pb-1 text-[11px] font-medium text-slate-500">
                  Secondary
                </div>
                {secondaryNav.map((item) => {
                  const isActive = router.pathname.startsWith(item.href);
                  const Icon = NAV_ICONS[item.href as keyof typeof NAV_ICONS] ?? LayoutDashboard;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                        isActive
                          ? "bg-white/8 text-white before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-[#f4c542] before:content-['']"
                          : "text-slate-500 hover:bg-white/6 hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </nav>
          <div className="border-t border-white/10 px-5 py-4">
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
              <div className="text-xs font-medium text-white">Internal use only</div>
              <div className="mt-1 text-xs text-slate-400">{formatRoleLabel(role)}</div>
            </div>
          </div>
        </aside>

        <header className="col-start-1 row-start-1 border-b border-slate-200 bg-white px-4 py-3 lg:col-start-2 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-950">{title}</div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                Secure staff zone
              </span>
            </div>
          </div>
          {kpis.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {kpis.map((kpi) => (
                <Link
                  key={kpi.label}
                  href={kpi.href}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition hover:text-white ${
                    KPI_STYLES[kpi.variant ?? "default"] ?? KPI_STYLES.default
                  }`}
                >
                  <span>{kpi.label}</span>
                  <span className="font-semibold text-white">{kpi.count}</span>
                </Link>
              ))}
            </div>
          )}
        </header>

        <main className="ops-workspace col-start-1 row-start-2 bg-[#f6f8fb] px-4 py-6 text-slate-900 lg:col-start-2 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
