import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { SUPPORT_EMAIL } from "@/lib/support";
import { useMessagesUnreadCount } from "@/lib/useMessagesUnreadCount";

type NavKey = "trips" | "messages" | "reviews" | "payments" | "profile";

type GuestShellLayoutProps = {
  activeNav?: NavKey;
  title?: string;
  children: ReactNode;
};

const navItems: Array<{ key: NavKey; label: string; href: string }> = [
  { key: "trips", label: "Trips", href: "/guest/dashboard" },
  { key: "messages", label: "Messages", href: "/guest/messages" },
  { key: "reviews", label: "Reviews", href: "/guest/reviews" },
  { key: "payments", label: "Payments", href: "/guest/payments" },
  { key: "profile", label: "Profile", href: "/guest/profile" },
];

export function GuestShellLayout({ activeNav, title, children }: GuestShellLayoutProps) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
  }, []);

  const unreadCount = useMessagesUnreadCount(userId, "guest-messages-unread");

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

  const pageTitle = useMemo(() => title || "Trips", [title]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white px-4 pb-6 pt-4 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-900 text-xs font-semibold uppercase text-white">
            fx
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-900">Flexivo</span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Travelling</span>
          </div>
        </div>

        <Separator className="mb-4 mt-4" />

        <nav className="flex-1 space-y-1 overflow-y-auto text-sm">
          {navItems.map((item) => {
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
        </nav>

        <div className="mt-4 space-y-2 text-xs text-slate-500">
          <p>Travelling mode.</p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="block font-medium text-slate-600 hover:text-slate-900">
            Need help? Contact support
          </a>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{pageTitle}</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-xs font-medium text-slate-500 hover:text-slate-900">
              Support
            </a>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {navItems.map((item) => {
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
                >
                  <span
                    className={cn(
                      "inline-flex whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold",
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-600"
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
