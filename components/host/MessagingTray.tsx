import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { XMarkIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type MessagingTrayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
  guestName?: string | null;
  bookingLabel?: string | null;
};

const formatMessageTime = (iso: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function MessagingTray({
  open,
  onOpenChange,
  conversationId,
  guestName,
  bookingLabel,
}: MessagingTrayProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
  }, []);

  const markConversationRead = useCallback(
    async (targetId: string | null) => {
      if (!targetId || !userId) return;
      try {
        await supabase.from("message_reads").upsert(
          {
            conversation_id: targetId,
            user_id: userId,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "conversation_id,user_id" }
        );
      } catch (err) {
        console.warn("[messaging] message_reads not available", err);
      }
    },
    [userId]
  );

  const loadMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load messages", error.message);
      setLoading(false);
      return;
    }

    setMessages((data as Message[]) ?? []);
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    loadMessages();
    markConversationRead(conversationId);

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message | null;
          if (!newMessage) return;
          setMessages((prev) => {
            if (prev.some((message) => message.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
          if (open) {
            markConversationRead(conversationId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, loadMessages, markConversationRead, open]);

  useEffect(() => {
    if (!open || !conversationId) return;
    markConversationRead(conversationId);
  }, [open, conversationId, markConversationRead]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open]);

  const handleSend = useCallback(async () => {
    if (!conversationId || !draft.trim()) return;
    const body = draft.trim();
    setSending(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const senderId = session?.user?.id;
      if (!senderId) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          body,
          sender_id: senderId,
        })
        .select("id, sender_id, body, created_at")
        .single();

      if (error) throw error;

      if (data) {
        setMessages((prev) => [...prev, data as Message]);
        await supabase
          .from("conversations")
          .update({ last_message_at: (data as Message).created_at })
          .eq("id", conversationId);
        await markConversationRead(conversationId);
      }

      setDraft("");
    } catch (err: any) {
      console.error("Failed to send message", err.message ?? err);
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, markConversationRead]);

  const headerTitle = guestName ? `Message ${guestName}` : "Message guest";
  const bookingText = bookingLabel ?? "";

  return (
    <div
      className={cn(
        "fixed right-0 top-0 z-40 h-full w-full max-w-[380px] translate-x-full border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200",
        open && "translate-x-0"
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{headerTitle}</p>
            {bookingText ? (
              <p className="text-xs text-slate-500">{bookingText}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <ScrollArea className="flex-1 px-4 py-4">
          {loading ? (
            <div className="text-sm text-slate-500">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="text-sm text-slate-500">No messages yet. Say hello.</div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const isMine = message.sender_id === userId;
                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex flex-col",
                      isMine ? "items-end" : "items-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                        isMine
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700"
                      )}
                    >
                      {message.body}
                    </div>
                    <span className="mt-1 text-[10px] text-slate-400">
                      {formatMessageTime(message.created_at)}
                    </span>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          )}
        </ScrollArea>

        <div className="border-t border-slate-200 px-4 py-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Write a message…"
              className="min-h-[60px] flex-1 resize-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              className="h-10 px-3"
            >
              <PaperAirplaneIcon className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Press Enter to send, Shift+Enter for a new line.
          </p>
        </div>
      </div>
    </div>
  );
}
