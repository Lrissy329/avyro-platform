import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { XMarkIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  sender_id: string | null;
  sender_role?: string | null;
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
  const [messageReadsAvailable, setMessageReadsAvailable] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
  }, []);

  const markConversationRead = useCallback(
    async (targetId: string | null) => {
      if (!targetId || !userId || !messageReadsAvailable) return;
      try {
        const { error } = await supabase.from("message_reads").upsert(
          {
            conversation_id: targetId,
            user_id: userId,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "conversation_id,user_id" }
        );
        if (error && isMissingMessageReads(error)) {
          setMessageReadsAvailable(false);
        }
      } catch (err) {
        if (isMissingMessageReads(err)) {
          setMessageReadsAvailable(false);
        }
      }
    },
    [messageReadsAvailable, userId]
  );

  const loadMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, sender_role, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      const fallback = await supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (fallback.error) {
        console.error("Failed to load messages", fallback.error.message);
        setLoading(false);
        return;
      }
      setMessages((fallback.data as Message[]) ?? []);
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

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onOpenChange]);

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
          sender_role: "host",
        })
        .select("id, sender_id, sender_role, body, created_at")
        .single();

      if (error) {
        const fallback = await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            body,
            sender_id: senderId,
          })
          .select("id, sender_id, body, created_at")
          .single();
        if (fallback.error) throw fallback.error;

        if (fallback.data) {
          setMessages((prev) => [...prev, fallback.data as Message]);
          await supabase
            .from("conversations")
            .update({ last_message_at: (fallback.data as Message).created_at })
            .eq("id", conversationId);
          await markConversationRead(conversationId);
        }

        setDraft("");
        return;
      }

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
    <>
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/20 opacity-0 transition-opacity duration-200",
          open && "pointer-events-auto opacity-100",
          !open && "pointer-events-none"
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden={!open}
      />
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
                const senderRole =
                  message.sender_role ??
                  (message.sender_id === userId ? "host" : "guest");
                const isSystemBody = message.body?.toLowerCase().startsWith("booking created");
                const isSystem =
                  senderRole === "system" || !message.sender_id || isSystemBody;
                const isHost = senderRole === "host";
                return (
                  <div
                    key={message.id}
                    className={cn("flex flex-col", isSystem ? "items-center" : isHost ? "items-end" : "items-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-4 py-3 text-sm",
                        isSystem
                          ? "border border-slate-200 bg-slate-50 text-slate-600 text-center"
                          : isHost
                            ? "border border-yellow-200 bg-yellow-50 text-slate-900"
                            : "bg-slate-100 text-slate-700"
                      )}
                    >
                      {message.body}
                    </div>
                    {!isSystem ? (
                      <span className="mt-1 text-[10px] text-slate-400">
                        {formatMessageTime(message.created_at)}
                      </span>
                    ) : null}
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
              className="min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200"
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
              className="h-11 px-4 rounded-xl"
            >
              <PaperAirplaneIcon className="h-4 w-4" />
              <span className="text-sm">{sending ? "Sending…" : "Send"}</span>
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Press Enter to send, Shift+Enter for a new line.
          </p>
        </div>
      </div>
    </div>
    </>
  );
}
