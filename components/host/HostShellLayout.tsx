// components/host/HostShellLayout.tsx
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type NavKey =
  | "dashboard"
  | "calendar"
  | "listings"
  | "messages"
  | "guests"
  | "payouts"
  | "settings";

type HostShellLayoutProps = {
  title?: string;
  activeNav?: NavKey;
  children: ReactNode;
};

const navItems: Array<{ key: NavKey; label: string; href: string; section: "Main" | "Finance" | "Utility" }> =
  [
    { key: "dashboard", label: "Dashboard", href: "/host/dashboard", section: "Main" },
    { key: "calendar", label: "Calendar", href: "/host/calendar", section: "Main" },
    { key: "listings", label: "Listings", href: "/host/listings", section: "Main" },
    { key: "messages", label: "Messages", href: "/host/messages", section: "Main" },
    { key: "guests", label: "Guests", href: "/host/guests", section: "Main" },
    { key: "payouts", label: "Payouts", href: "/host/payouts", section: "Finance" },
    { key: "settings", label: "Settings", href: "/host/settings", section: "Utility" },
  ];

export function HostShellLayout({ title, activeNav, children }: HostShellLayoutProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white/95 px-4 pb-6 pt-4 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-900 text-xs font-semibold text-white">
            avy
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-900">Avyro</span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Host dashboard</span>
          </div>
        </div>

        <Separator className="mt-4 mb-4" />

        <nav className="flex-1 space-y-4 overflow-y-auto text-sm">
          <div>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Main</p>
            <div className="mt-2 space-y-1">
              {navItems
                .filter((n) => n.section === "Main")
                .map((item) => {
                  const active =
                    activeNav === item.key ||
                    (!activeNav && (router.pathname === item.href || router.pathname.startsWith(item.href)));
                  return (
                    <Link key={item.href} href={item.href}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors",
                          active
                            ? "bg-slate-900 text-white shadow-[0_10px_30px_rgba(15,23,42,0.45)]"
                            : "text-slate-500 hover:bg-slate-100"
                        )}
                      >
                        <span>{item.label}</span>
                      </button>
                    </Link>
                  );
                })}
            </div>
          </div>

          <div>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Finance</p>
            <div className="mt-2 space-y-1">
              {navItems
                .filter((n) => n.section === "Finance")
                .map((item) => {
                  const active =
                    activeNav === item.key ||
                    (!activeNav && (router.pathname === item.href || router.pathname.startsWith(item.href)));
                  return (
                    <Link key={item.href} href={item.href}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors",
                          active
                            ? "bg-slate-900 text-white shadow-[0_10px_30px_rgba(15,23,42,0.45)]"
                            : "text-slate-500 hover:bg-slate-100"
                        )}
                      >
                        <span>{item.label}</span>
                      </button>
                    </Link>
                  );
                })}
            </div>
          </div>

          <div>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Utility</p>
            <div className="mt-2 space-y-1">
              {navItems
                .filter((n) => n.section === "Utility")
                .map((item) => {
                  const active =
                    activeNav === item.key ||
                    (!activeNav && (router.pathname === item.href || router.pathname.startsWith(item.href)));
                  return (
                    <Link key={item.href} href={item.href}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors",
                          active
                            ? "bg-slate-900 text-white shadow-[0_10px_30px_rgba(15,23,42,0.45)]"
                            : "text-slate-500 hover:bg-slate-100"
                        )}
                      >
                        <span>{item.label}</span>
                      </button>
                    </Link>
                  );
                })}
            </div>
          </div>
        </nav>

        <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-100 px-3 py-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src="/avatars/host-placeholder.svg" alt="Host" />
            <AvatarFallback>H</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-xs font-medium text-slate-900">Your host account</span>
            <span className="text-[11px] text-slate-500">View profile</span>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur-sm lg:px-8">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold text-slate-900">{title ?? "Dashboard"}</h1>
            <span className="hidden text-xs text-slate-500 sm:inline">
              Monitor bookings, payouts & occupancy in one place.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 border border-slate-200">
              <AvatarImage src="/avatars/host-placeholder.svg" alt="Host" />
              <AvatarFallback>H</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
