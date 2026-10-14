// components/host/HostShellLayout.tsx
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { useMessagesUnreadCount } from "@/lib/useMessagesUnreadCount";

type NavKey =
  | "dashboard"
  | "calendar"
  | "listings"
  | "messages"
  | "guests"
  | "payouts"
  | "settings"
  | "profile";

type HostShellLayoutProps = {
  title?: string;
  activeNav?: NavKey;
  variant?: "default" | "wide";
  children: ReactNode;
};

const navItems: Array<{ key: NavKey; label: string; href: string; section: "Main" | "Finance" | "Utility" }> =
  [
    { key: "dashboard", label: "Hosting insights", href: "/host/dashboard", section: "Main" },
    { key: "calendar", label: "Calendar", href: "/host/calendar", section: "Main" },
    { key: "listings", label: "Your places", href: "/host/listings", section: "Main" },
    { key: "messages", label: "Messages", href: "/host/messages", section: "Main" },
    { key: "guests", label: "Occupancy", href: "/host/guests", section: "Main" },
    { key: "payouts", label: "Earnings", href: "/host/payouts", section: "Finance" },
    { key: "profile", label: "Profile", href: "/host/profile", section: "Utility" },
    { key: "settings", label: "Settings", href: "/host/settings", section: "Utility" },
  ];

export function HostShellLayout({
  title,
  activeNav,
  variant = "default",
  children,
}: HostShellLayoutProps) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
  }, []);

  const unreadCount = useMessagesUnreadCount(userId, "host-messages-unread");

  const normalizePath = useCallback((value: string) => {
    const [withoutHash] = value.split("#");
    const [withoutQuery] = withoutHash.split("?");
    const trimmed = withoutQuery.replace(/\/+$/, "");
    return trimmed || "/";
  }, []);

  const isCurrentPath = useCallback(
    (href: string) => normalizePath(router.asPath) === normalizePath(href),
    [normalizePath, router.asPath]
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white px-4 pb-6 pt-4 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold uppercase text-white">
            fx
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-900">Flexivo</span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Hosting</span>
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
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={(event) => {
                        if (isCurrentPath(item.href)) event.preventDefault();
                      }}
                      className={cn(
                        "relative flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                        active
                          ? "bg-slate-100 text-slate-900 font-medium before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:rounded-r before:bg-yellow-400"
                          : "text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      <span>{item.label}</span>
                      {item.key === "messages" && unreadCount > 0 ? (
                        <span className="ml-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-[#FEDD02] px-1.5 text-[10px] font-semibold text-slate-900">
                          {unreadCount}
                        </span>
                      ) : null}
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
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={(event) => {
                        if (isCurrentPath(item.href)) event.preventDefault();
                      }}
                      className={cn(
                        "relative flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                        active
                          ? "bg-slate-100 text-slate-900 font-medium before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:rounded-r before:bg-yellow-400"
                          : "text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      <span>{item.label}</span>
                      {item.key === "messages" && unreadCount > 0 ? (
                        <span className="ml-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-[#FEDD02] px-1.5 text-[10px] font-semibold text-slate-900">
                          {unreadCount}
                        </span>
                      ) : null}
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
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={(event) => {
                        if (isCurrentPath(item.href)) event.preventDefault();
                      }}
                      className={cn(
                        "relative flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                        active
                          ? "bg-slate-100 text-slate-900 font-medium before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:rounded-r before:bg-yellow-400"
                          : "text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      <span>{item.label}</span>
                      {item.key === "messages" && unreadCount > 0 ? (
                        <span className="ml-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-[#FEDD02] px-1.5 text-[10px] font-semibold text-slate-900">
                          {unreadCount}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
            </div>
          </div>
        </nav>

        <div className="mt-4 text-xs text-slate-500">Hosting mode.</div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <main className="flex-1">
          <div
            className={cn(
              "mx-auto w-full py-8",
              variant === "wide"
                ? "max-w-none px-6 lg:px-8 2xl:px-10"
                : "max-w-7xl px-8"
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
