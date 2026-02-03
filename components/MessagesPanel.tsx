import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";

type Conversation = {
  id: string;
  booking_id: string | null;
  host_id: string;
  guest_id: string;
  last_message_at: string | null;
};

type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type MessagesPanelProps = {
  role: "host" | "guest";
};

type BookingMeta = {
  listingId: string | null;
  title: string | null;
  location: string | null;
};

type PartnerProfile = {
  name: string | null;
  email: string | null;
};

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const formatConversationTimestamp = (iso?: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const formatMessageTime = (iso: string) => {
  const fallback = "";
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function MessagesPanel({ role }: MessagesPanelProps) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [bookingMeta, setBookingMeta] = useState<Record<string, BookingMeta>>({});
  const [partnerProfiles, setPartnerProfiles] = useState<Record<string, PartnerProfile>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, Message>>({});
  const partnerProfilesRef = useRef<Record<string, PartnerProfile>>({});
  const lastMessagesRef = useRef<Record<string, Message>>({});
  const cacheLastMessage = useCallback((conversationId: string, message: Message) => {
    setLastMessages((prev) => {
      const next = { ...prev, [conversationId]: message };
      lastMessagesRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user?.id ?? null;
      setUserId(id);
    });
  }, []);

  const loadBookingMeta = useCallback(
    async (bookingIds: string[]) => {
      const missingIds = bookingIds.filter((id) => !bookingMeta[id]);
      if (missingIds.length === 0) return;

      const { data: bookingRows, error: bookingError } = await supabase
        .from("bookings")
        .select("id, listing_id")
        .in("id", missingIds);

      if (bookingError || !bookingRows) return;

      const listingIds = Array.from(
        new Set(
          (bookingRows as { id: string; listing_id: string | null }[])
            .map((row) => row.listing_id)
            .filter(Boolean)
        )
      ) as string[];

      let listingsLookup: Record<string, { title: string | null; location: string | null }> = {};

      if (listingIds.length > 0) {
        const { data: listingRows, error: listingError } = await supabase
          .from("listings")
          .select("id, title, location")
          .in("id", listingIds);

        if (!listingError && listingRows) {
          listingsLookup = (listingRows as { id: string; title: string | null; location: string | null }[]).reduce(
            (acc, curr) => {
              acc[curr.id] = { title: curr.title, location: curr.location };
              return acc;
            },
            {} as Record<string, { title: string | null; location: string | null }>
          );
        }
      }

      setBookingMeta((prev) => {
        const next = { ...prev };
        (bookingRows as { id: string; listing_id: string | null }[]).forEach((row) => {
          const listingInfo = row.listing_id ? listingsLookup[row.listing_id] : undefined;
          next[row.id] = {
            listingId: row.listing_id ?? null,
            title: listingInfo?.title ?? null,
            location: listingInfo?.location ?? null,
          };
        });
        return next;
      });
    },
    [bookingMeta]
  );

  const loadPartnerProfiles = useCallback(async (userIds: string[]) => {
    const missing = userIds.filter((id) => id && !partnerProfilesRef.current[id]);
    if (missing.length === 0) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", missing);

    if (error || !data) return;

    const lookup = (data as { id: string; full_name: string | null; email: string | null }[]).reduce(
      (acc, curr) => {
        acc[curr.id] = { name: curr.full_name, email: curr.email };
        return acc;
      },
      {} as Record<string, PartnerProfile>
    );
    setPartnerProfiles((prev) => {
      const next = { ...prev, ...lookup };
      partnerProfilesRef.current = next;
      return next;
    });
  }, []);

  const loadLastMessages = useCallback(async (conversationIds: string[]) => {
    const missing = conversationIds.filter((id) => id && !lastMessagesRef.current[id]);
    if (missing.length === 0) return;

    const results = await Promise.all(
      missing.map(async (conversationId) => {
        const { data, error } = await supabase
          .from("messages")
          .select("id, sender_id, body, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (error || !data || data.length === 0) return null;
        return { conversationId, message: data[0] as Message };
      })
    );

    setLastMessages((prev) => {
      const next = { ...prev };
      results.forEach((row) => {
        if (row?.conversationId && row.message) {
          next[row.conversationId] = row.message;
        }
      });
      lastMessagesRef.current = next;
      return next;
    });
  }, []);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("conversations")
      .select("id, booking_id, host_id, guest_id, last_message_at")
      .order("last_message_at", { ascending: false });

    if (error) {
      console.error("Failed to load conversations", error.message);
      setConversations([]);
      setLoading(false);
      return;
    }

    const rows = (data as Conversation[]) ?? [];
    setConversations(rows);
    setSelectedConversation((prev) => {
      if (!prev) return rows[0]?.id ?? null;
      return rows.some((row) => row.id === prev) ? prev : rows[0]?.id ?? null;
    });

    const bookingIds = Array.from(
      new Set(rows.map((conversation) => conversation.booking_id).filter(Boolean))
    ) as string[];
    if (bookingIds.length > 0) {
      await loadBookingMeta(bookingIds);
    }
    const partnerIds = Array.from(
      new Set(
        rows.map((conversation) =>
          role === "host" ? conversation.guest_id : conversation.host_id
        )
      )
    );
    if (partnerIds.length > 0) {
      await loadPartnerProfiles(partnerIds);
    }
    const conversationIds = rows.map((conversation) => conversation.id);
    if (conversationIds.length > 0) {
      await loadLastMessages(conversationIds);
    }

    setLoading(false);
  }, [loadBookingMeta, loadPartnerProfiles, loadLastMessages, role]);

  useEffect(() => {
    if (!userId) return;

    loadConversations();

    const channel = supabase
      .channel(`conversations:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        (payload) => {
          const newRow = payload.new as Conversation | null;
          if (!newRow) return;
          if (newRow.host_id !== userId && newRow.guest_id !== userId) return;
          loadConversations();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        (payload) => {
          const newRow = payload.new as Conversation | null;
          if (!newRow) return;
          if (newRow.host_id !== userId && newRow.guest_id !== userId) return;
          setConversations((prev) => {
            const next = prev.map((conversation) =>
              conversation.id === newRow.id
                ? { ...conversation, last_message_at: newRow.last_message_at }
                : conversation
            );
            next.sort((a, b) => {
              const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return bTime - aTime;
            });
            return next;
          });

          if (newRow.booking_id) {
            loadBookingMeta([newRow.booking_id]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadConversations, loadBookingMeta]);

  const loadMessagesForConversation = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load messages", error.message);
      setMessages([]);
      return;
    }

    const rows = (data as Message[]) ?? [];
    setMessages(rows);
    if (rows.length > 0) {
      const latest = rows[rows.length - 1];
      cacheLastMessage(conversationId, latest);
    }
  }, [cacheLastMessage]);

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      return;
    }

    loadMessagesForConversation(selectedConversation);

    const channel = supabase
      .channel(`messages:${selectedConversation}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedConversation}`,
        },
        (payload) => {
          const newMessage = payload.new as Message | null;
          if (!newMessage) return;
          setMessages((prev) => {
            if (prev.some((message) => message.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
          cacheLastMessage(selectedConversation, newMessage);
          setConversations((prev) => {
            const next = prev.map((conversation) =>
              conversation.id === selectedConversation
                ? { ...conversation, last_message_at: newMessage.created_at }
                : conversation
            );
            next.sort((a, b) => {
              const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return bTime - aTime;
            });
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversation, loadMessagesForConversation, cacheLastMessage]);

  const partnerLabel = (conversation: Conversation) => {
    if (!userId) return "";
    return userId === conversation.host_id ? "Guest" : "Host";
  };

  const handleSend = async () => {
    if (!selectedConversation || !messageDraft.trim()) return;
    setSending(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const senderId = session?.user?.id;
      if (!senderId) {
        throw new Error("Not signed in");
      }

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: selectedConversation,
          body: messageDraft.trim(),
          sender_id: senderId,
        })
        .select("id, sender_id, body, created_at");

      if (error) throw error;

      const inserted = Array.isArray(data) ? (data[0] as Message | undefined) : undefined;
      if (inserted) {
        setMessages((prev) => [...prev, inserted]);
        cacheLastMessage(selectedConversation, inserted);
        setConversations((prev) => {
          const next = prev.map((conversation) =>
            conversation.id === selectedConversation
              ? { ...conversation, last_message_at: inserted.created_at }
              : conversation
          );
          next.sort((a, b) => {
            const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return bTime - aTime;
          });
          return next;
        });
      }

      setMessageDraft("");
    } catch (err: any) {
      console.error("Failed to send message", err.message ?? err);
    } finally {
      setSending(false);
    }
  };

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversation) ?? null,
    [conversations, selectedConversation]
  );

  const selectedMeta = selected?.booking_id ? bookingMeta[selected.booking_id] : null;
  const selectedPartnerId = selected
    ? role === "host"
      ? selected.guest_id
      : selected.host_id
    : null;
  const selectedPartner =
    selectedPartnerId && partnerProfiles[selectedPartnerId]
      ? partnerProfiles[selectedPartnerId]
      : null;

  const deleteConversationRecords = async (conversationId: string) => {
    await supabase.from("messages").delete().eq("conversation_id", conversationId);
    await supabase.from("conversations").delete().eq("id", conversationId);
  };

  const handleDeleteConversation = async (conversationId?: string) => {
    const targetId = conversationId ?? selectedConversation;
    if (!targetId) return;
    const confirmed = window.confirm("Delete this conversation for both participants?");
    if (!confirmed) return;

    setDeletingConversationId(targetId);
    try {
      await deleteConversationRecords(targetId);

      setConversations((prev) => {
        const filtered = prev.filter((conversation) => conversation.id !== targetId);
        if (selectedConversation === targetId) {
          setSelectedConversation(filtered[0]?.id ?? null);
          setMessages([]);
        }
        return filtered;
      });
    } catch (err: any) {
      console.error("Failed to delete conversation", err?.message ?? err);
      alert("Unable to delete conversation. Please try again.");
    } finally {
      setDeletingConversationId(null);
    }
  };

  const partnerName = (conversation: Conversation) => {
    const partnerId = role === "host" ? conversation.guest_id : conversation.host_id;
    const profile = partnerProfiles[partnerId];
    if (profile?.name?.trim()) return profile.name;
    if (profile?.email) return profile.email;
    return partnerLabel(conversation) || "Guest";
  };

  const handleViewBooking = () => {
    if (!selected?.booking_id) return;
    router.push(`/booking/${selected.booking_id}`).catch(() => null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSend();
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)]">
        <aside className="flex flex-col rounded-3xl bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Messages</h2>
              <p className="text-[11px] text-slate-500">Inbox</p>
            </div>
          </div>
          <div className="max-h-[600px] flex-1 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-sm text-slate-500">Loading conversations…</p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">
                {role === "host"
                  ? "No guest messages yet. Approvals can start the conversation."
                  : "You haven't messaged any hosts yet."}
              </p>
            ) : (
              conversations.map((conversation) => {
                const meta = conversation.booking_id ? bookingMeta[conversation.booking_id] : null;
                const last = lastMessages[conversation.id];
                const unread = Boolean(last && userId && last.sender_id !== userId);
                return (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedConversation(conversation.id)}
                    className={cx(
                      "w-full border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50",
                      selectedConversation === conversation.id && "bg-slate-50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 h-8 w-8 rounded-full bg-slate-200" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {partnerName(conversation)}
                          </p>
                          <span className="text-[11px] text-slate-400">
                            {last ? formatConversationTimestamp(last.created_at) : ""}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-500">
                          {meta?.title ?? "Conversation"}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {last?.body ?? "No messages yet."}
                        </p>
                      </div>
                      {unread && (
                        <span className="ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#4B5563] text-[10px] font-medium text-white">
                          ●
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex flex-col rounded-3xl border border-slate-200 bg-white min-h-[480px]">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-slate-200" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {selectedPartner?.name ?? partnerLabel(selected) ?? "Conversation"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {selectedMeta?.title ?? "Listing"}{" "}
                      {selectedMeta?.location ? `· ${selectedMeta.location}` : ""}
                    </p>
                  </div>
                </div>
                {selected?.booking_id ? (
                  <button
                    onClick={handleViewBooking}
                    className="text-xs font-medium text-[#FEDD02] hover:text-[#E6C902]"
                  >
                    View booking →
                  </button>
                ) : (
                  <button
                    onClick={() => handleDeleteConversation()}
                    disabled={
                      !selectedConversation || deletingConversationId === selectedConversation
                    }
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                  >
                    {deletingConversationId === selectedConversation
                      ? "Deleting…"
                      : "Delete conversation"}
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto bg-slate-50/60 px-5 py-4">
                {messages.length === 0 ? (
                  <p className="text-sm text-slate-500">No messages yet. Say hello!</p>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg) => {
                      const isMine = msg.sender_id === userId;
                      return (
                        <div
                          key={msg.id}
                          className={cx("flex", isMine ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cx(
                              "max-w-sm rounded-2xl px-3 py-2 text-xs shadow-sm",
                              isMine
                                ? "bg-[#0B0D10] text-white"
                                : "bg-white text-slate-800"
                            )}
                          >
                            <p className="leading-snug">{msg.body}</p>
                            <p
                              className={cx(
                                "mt-1 text-[10px]",
                                isMine ? "text-slate-300 text-right" : "text-slate-400"
                              )}
                            >
                              {formatMessageTime(msg.created_at)}
                              {isMine ? " · Sent" : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSubmit}
                className="border-t border-slate-100 px-4 py-3 flex items-center gap-3"
              >
                <input
                  type="text"
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  placeholder="Write a message…"
                  className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm focus:border-[#FEDD02] focus:outline-none focus:ring-2 focus:ring-[#FEDD02]/30"
                />
                <button
                  type="submit"
                  disabled={sending || !messageDraft.trim()}
                  className="inline-flex items-center rounded-full bg-[#FEDD02] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#E6C902] active:bg-[#C9B002] disabled:cursor-not-allowed disabled:bg-[#FEDD02]/40"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
              Select a conversation to start messaging.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
