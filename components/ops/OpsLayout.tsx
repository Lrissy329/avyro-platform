import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";
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

export default function OpsLayout({ title, children, kpis = [], role }: OpsLayoutProps) {
  const router = useRouter();
  const navItems = getOpsNavItems(role);

  return (
    <div data-theme="ops" className="min-h-screen bg-[var(--ops-bg)] text-[var(--ops-text)]">
      <div className="grid min-h-screen grid-cols-1 grid-rows-[auto_1fr] lg:grid-cols-[260px_1fr]">
        <aside className="row-span-2 hidden flex-col border-r border-white/10 bg-[var(--ops-panel)] lg:flex">
          <div className="px-5 py-6 text-xs font-semibold uppercase tracking-[0.28em] text-white/60">
            Ops Console
          </div>
          <nav className="flex-1 space-y-1 px-3 pb-6">
            {navItems.map((item) => {
              const isActive = router.pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex items-center rounded-xl px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    isActive
                      ? "bg-white/10 text-white translate-x-[1px] before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r before:bg-white before:content-['']"
                      : "text-white hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-white/10 px-5 py-4 text-xs text-white/60">
            Internal use only
          </div>
        </aside>

        <header className="col-start-1 row-start-1 border-b border-white/10 bg-[var(--ops-panel)] px-4 py-3 lg:col-start-2 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">
              {title}
            </div>
            <div className="flex items-center gap-2 text-xs text-white/60">
              <span className="rounded-full border border-white/10 px-2 py-1">
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
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs uppercase tracking-[0.2em] transition hover:text-white ${
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

        <main className="ops-workspace col-start-1 row-start-2 bg-slate-50 px-4 py-6 text-slate-900 lg:col-start-2 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
