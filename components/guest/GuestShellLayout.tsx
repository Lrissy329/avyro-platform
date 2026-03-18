import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";

type NavKey = "trips" | "messages" | "reviews" | "payments" | "profile";

type GuestShellLayoutProps = {
  activeNav?: NavKey;
  title?: string;
  children: ReactNode;
};

type ConversationRow = {
  id: string;
  host_id: string;
  guest_id: string;
  last_message_at: string | null;
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
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
  }, []);

  const refreshUnread = useCallback(async () => {
    if (!userId) return;

    const { data: conversations, error: conversationError } = await supabase
      .from("conversations")
      .select("id, host_id, guest_id, last_message_at")
      .or(`host_id.eq.${userId},guest_id.eq.${userId}`);

    if (conversationError || !conversations) {
      return;
    }

    let reads: Array<{ conversation_id: string; last_read_at: string | null }> = [];
    try {
      const { data: readRows, error: readError } = await supabase
        .from("message_reads")
        .select("conversation_id, last_read_at")
        .eq("user_id", userId);
      if (!readError && readRows) {
        reads = readRows as Array<{ conversation_id: string; last_read_at: string | null }>;
      }
    } catch {
      // message_reads may not exist in all environments.
    }

    const readMap = reads.reduce<Record<string, number>>((acc, row) => {
      if (row.last_read_at) {
        acc[row.conversation_id] = new Date(row.last_read_at).getTime();
      }
      return acc;
    }, {});

    const unread = (conversations as ConversationRow[]).reduce((count, conversation) => {
      if (!conversation.last_message_at) return count;
      const lastMessageAt = new Date(conversation.last_message_at).getTime();
      const lastReadAt = readMap[conversation.id];
      if (!lastReadAt || lastMessageAt > lastReadAt) {
        return count + 1;
      }
      return count;
    }, 0);

    setUnreadCount(unread);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    refreshUnread();

    const channel = supabase
      .channel(`guest-messages-unread:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const row = payload.new as ConversationRow | null;
          if (!row) return;
          if (row.host_id !== userId && row.guest_id !== userId) return;
          refreshUnread();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reads", filter: `user_id=eq.${userId}` },
        () => refreshUnread()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refreshUnread]);

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

  const pageTitle = useMemo(() => title || "Guest dashboard", [title]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white px-4 pb-6 pt-4 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-900 text-xs font-semibold text-white">
            avy
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-900">Avyro</span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Guest dashboard</span>
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

        <div className="mt-4 text-xs text-slate-500">Signed in as guest.</div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <p className="text-sm font-semibold text-slate-900">{pageTitle}</p>
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
