import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabaseClient";

type ConversationRow = {
  id: string;
  host_id: string;
  guest_id: string;
  last_message_at: string | null;
};

type ReadRow = {
  conversation_id: string;
  last_read_at: string | null;
};

const isMissingMessageReads = (error: any) => {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42p01" ||
    code === "42703" ||
    code === "pgrst204" ||
    message.includes("message_reads") ||
    message.includes("schema cache") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

/**
 * The real unread-conversation count for the current user, used by both HostShellLayout and
 * GuestShellLayout's nav badge. Previously each shell computed this independently and both got
 * it wrong the same way: "conversation has ever had a message" rather than "has a message newer
 * than my own read receipt" -- see the messaging deep-dive findings. This is the single shared
 * source for that calculation; fix it once, both shells pick it up.
 *
 * channelKey keeps the two shells' realtime subscriptions on distinct channel names
 * (e.g. "host-messages-unread" / "guest-messages-unread"), matching what each already used.
 */
export function useMessagesUnreadCount(userId: string | null, channelKey: string): number {
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }

    const { data: conversations, error: conversationsError } = await supabase
      .from("conversations")
      .select("id, host_id, guest_id, last_message_at")
      .or(`host_id.eq.${userId},guest_id.eq.${userId}`);

    if (conversationsError || !conversations) return;

    const rows = conversations as ConversationRow[];
    const conversationIds = rows.map((row) => row.id);

    let lastReadAtByConversation: Record<string, number> = {};
    if (conversationIds.length > 0) {
      const { data: reads, error: readsError } = await supabase
        .from("message_reads")
        .select("conversation_id, last_read_at")
        .eq("user_id", userId)
        .in("conversation_id", conversationIds);

      // message_reads may not exist yet in every environment (same schema-drift tolerance as
      // the rest of the messaging UI). Without it we can't tell what's actually unread, so we
      // show nothing rather than reverting to the old "has any message" miscount.
      if (readsError) {
        if (!isMissingMessageReads(readsError)) {
          console.error("[useMessagesUnreadCount] failed to load read receipts", readsError.message);
        }
        setUnreadCount(0);
        return;
      }

      lastReadAtByConversation = (reads as ReadRow[] | null ?? []).reduce<Record<string, number>>(
        (acc, row) => {
          if (row.last_read_at) acc[row.conversation_id] = new Date(row.last_read_at).getTime();
          return acc;
        },
        {}
      );
    }

    const unread = rows.reduce((count, convo) => {
      if (!convo.last_message_at) return count;
      const lastMessageAt = new Date(convo.last_message_at).getTime();
      const lastReadAt = lastReadAtByConversation[convo.id] ?? 0;
      return lastMessageAt > lastReadAt ? count + 1 : count;
    }, 0);

    setUnreadCount(unread);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    refresh();

    const channel = supabase
      .channel(`${channelKey}:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const row = payload.new as ConversationRow | null;
          if (!row) return;
          if (row.host_id !== userId && row.guest_id !== userId) return;
          refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reads", filter: `user_id=eq.${userId}` },
        () => refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, channelKey, refresh]);

  return unreadCount;
}
