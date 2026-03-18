import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PaperAirplaneIcon } from "@heroicons/react/24/outline";

type Conversation = {
  id: string;
  booking_id: string | null;
  host_id: string;
  guest_id: string;
  last_message_at: string | null;
  created_at?: string | null;
};

type Message = {
  id: string;
  sender_id: string | null;
  sender_role?: string | null;
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
  checkIn: string | null;
  checkOut: string | null;
  status: string | null;
  createdAt: string | null;
};

type PartnerProfile = {
  name: string | null;
  email: string | null;
  avatar_url?: string | null;
};

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const statusStyles: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  awaiting_payment: "bg-amber-50 text-amber-700 border-amber-200",
  pending_payment: "bg-amber-50 text-amber-700 border-amber-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
  declined: "bg-red-50 text-red-600 border-red-200",
  refunded: "bg-red-50 text-red-600 border-red-200",
  completed: "bg-slate-100 text-slate-600 border-slate-200",
};

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

const formatRange = (checkIn?: string | null, checkOut?: string | null) => {
  if (!checkIn || !checkOut) return "";
  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  if (Number.isNaN(inDate.getTime()) || Number.isNaN(outDate.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return `${formatter.format(inDate)} → ${formatter.format(outDate)}`;
};

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

export function MessagesPanel({ role }: MessagesPanelProps) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [bookingMeta, setBookingMeta] = useState<Record<string, BookingMeta>>({});
  const [partnerProfiles, setPartnerProfiles] = useState<Record<string, PartnerProfile>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, Message>>({});
  const [readMap, setReadMap] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const endRef = useRef<HTMLDivElement | null>(null);
  const threadQuery = typeof router.query.thread === "string" ? router.query.thread : null;
  const bookingQuery = typeof router.query.bookingId === "string" ? router.query.bookingId : null;

  const lastMessagesRef = useRef<Record<string, Message>>({});
  const bookingMetaRef = useRef<Record<string, BookingMeta>>({});
  const partnerProfilesRef = useRef<Record<string, PartnerProfile>>({});
  const conversationsLoadingRef = useRef(false);

  const cacheLastMessage = useCallback((conversationId: string, message: Message) => {
    setLastMessages((prev) => {
      const next = { ...prev, [conversationId]: message };
      lastMessagesRef.current = next;
      return next;
    });
  }, []);

  const markConversationRead = useCallback(
    async (conversationId: string | null) => {
      if (!conversationId || !userId) return;
      try {
        await supabase.from("message_reads").upsert(
          {
            conversation_id: conversationId,
            user_id: userId,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "conversation_id,user_id" }
        );
        setReadMap((prev) => ({ ...prev, [conversationId]: Date.now() }));
      } catch (err) {
        console.warn("[messages] message_reads not available", err);
      }
    },
    [userId]
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user?.id ?? null;
      setUserId(id);
    });
  }, []);

  const loadBookingMeta = useCallback(async (bookingIds: string[]) => {
    const missingIds = bookingIds.filter((id) => !bookingMetaRef.current[id]);
    if (missingIds.length === 0) return;

    const bookingSelects = [
      "id, listing_id, check_in_time, check_out_time, check_in, check_out, status, created_at",
      "id, listing_id, check_in, check_out, status, created_at",
    ];

    let bookingRows: any[] = [];
    let bookingError: any = null;

    for (const select of bookingSelects) {
      const { data, error } = await supabase
        .from("bookings")
        .select(select)
        .in("id", missingIds);

      bookingRows = data ?? [];
      bookingError = error;
      if (!bookingError) break;
      if (!isMissingColumn(bookingError)) break;
    }

    if (bookingError || !bookingRows) return;

    const listingIds = Array.from(
      new Set(
        bookingRows
          .map((row: any) => row.listing_id)
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
        listingsLookup = listingRows.reduce(
          (acc: Record<string, { title: string | null; location: string | null }>, curr: any) => {
            acc[curr.id] = { title: curr.title, location: curr.location };
            return acc;
          },
          {}
        );
      }
    }

    setBookingMeta((prev) => {
      const next = { ...prev };
      bookingRows.forEach((row: any) => {
        const listingInfo = row.listing_id ? listingsLookup[row.listing_id] : undefined;
        next[row.id] = {
          listingId: row.listing_id ?? null,
          title: listingInfo?.title ?? null,
          location: listingInfo?.location ?? null,
          checkIn: row.check_in_time ?? row.check_in ?? null,
          checkOut: row.check_out_time ?? row.check_out ?? null,
          status: row.status ?? null,
          createdAt: row.created_at ?? null,
        };
      });
      bookingMetaRef.current = next;
      return next;
    });
  }, []);

  const loadPartnerProfiles = useCallback(async (userIds: string[]) => {
    const missing = userIds.filter((id) => id && !partnerProfilesRef.current[id]);
    if (missing.length === 0) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", missing);

    if (error || !data) return;

    const lookup = (data as any[]).reduce((acc: Record<string, PartnerProfile>, curr) => {
      acc[curr.id] = { name: curr.full_name, email: curr.email, avatar_url: curr.avatar_url };
      return acc;
    }, {});

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
          .select("id, sender_id, sender_role, body, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (error && isMissingColumn(error)) {
          const fallback = await supabase
            .from("messages")
            .select("id, sender_id, body, created_at")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(1);
          if (fallback.error || !fallback.data || fallback.data.length === 0) return null;
          return { conversationId, message: fallback.data[0] as Message };
        }

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

  const loadReads = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from("message_reads")
        .select("conversation_id, last_read_at")
        .eq("user_id", userId);
      if (error || !data) return;
      const next = (data as { conversation_id: string; last_read_at: string | null }[]).reduce<
        Record<string, number>
      >((acc, row) => {
        if (row.last_read_at) {
          acc[row.conversation_id] = new Date(row.last_read_at).getTime();
        }
        return acc;
      }, {});
      setReadMap(next);
    } catch (err) {
      console.warn("[messages] message_reads not available", err);
    }
  }, [userId]);

  const loadConversations = useCallback(async (showLoading = false) => {
    if (!userId) return;
    if (conversationsLoadingRef.current) return;
    conversationsLoadingRef.current = true;
    if (showLoading) {
      setLoading(true);
    }
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, booking_id, host_id, guest_id, last_message_at, created_at")
        .or(`host_id.eq.${userId},guest_id.eq.${userId}`)
        .order("last_message_at", { ascending: false });

      if (error) {
        console.error("Failed to load conversations", error.message);
        setConversations([]);
        return;
      }

      const rows = (data as Conversation[]) ?? [];
      setConversations(rows);

      const bookingIds = Array.from(
        new Set(rows.map((conversation) => conversation.booking_id).filter(Boolean))
      ) as string[];
      if (bookingIds.length > 0) {
        await loadBookingMeta(bookingIds);
      }

      const partnerIds = Array.from(
        new Set(rows.map((conversation) => (role === "host" ? conversation.guest_id : conversation.host_id)))
      );
      if (partnerIds.length > 0) {
        await loadPartnerProfiles(partnerIds);
      }

      const conversationIds = rows.map((conversation) => conversation.id);
      if (conversationIds.length > 0) {
        await loadLastMessages(conversationIds);
      }

      await loadReads();
    } finally {
      if (showLoading) {
        setLoading(false);
      }
      conversationsLoadingRef.current = false;
    }
  }, [loadBookingMeta, loadPartnerProfiles, loadLastMessages, loadReads, role, userId]);

  useEffect(() => {
    if (!userId) return;

    loadConversations(true);

    const channel = supabase
      .channel(`conversations:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const newRow = payload.new as Conversation | null;
          if (!newRow) return;
          if (newRow.host_id !== userId && newRow.guest_id !== userId) return;
          loadConversations(false);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reads", filter: `user_id=eq.${userId}` },
        () => loadReads()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadConversations, loadReads]);

  const loadMessagesForConversation = useCallback(async (conversationId: string) => {
    let messagesRows: Message[] = [];
    let messagesError: any = null;

    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, sender_role, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    messagesRows = (data as Message[]) ?? [];
    messagesError = error;

    if (messagesError && isMissingColumn(messagesError)) {
      const fallback = await supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      messagesRows = (fallback.data as Message[]) ?? [];
      messagesError = fallback.error;
    }

    if (messagesError) {
      console.error("Failed to load messages", messagesError.message);
      setMessages([]);
      return;
    }

    setMessages(messagesRows);
    if (messagesRows.length > 0) {
      const latest = messagesRows[messagesRows.length - 1];
      cacheLastMessage(conversationId, latest);
    }
  }, [cacheLastMessage]);

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      return;
    }

    loadMessagesForConversation(selectedConversation);
    markConversationRead(selectedConversation);

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
          markConversationRead(selectedConversation);
          setConversations((prev) => {
            const next = prev.map((conversation) =>
              conversation.id === selectedConversation
                ? { ...conversation, last_message_at: newMessage.created_at }
                : conversation
            );
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversation, loadMessagesForConversation, cacheLastMessage, markConversationRead]);

  useEffect(() => {
    if (!selectedConversation || !messages.length) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, selectedConversation]);

  const partnerLabel = useCallback((conversation: Conversation) => {
    if (!userId) return "";
    return userId === conversation.host_id ? "Guest" : "Host";
  }, [userId]);

  const partnerName = useCallback((conversation: Conversation) => {
    const partnerId = role === "host" ? conversation.guest_id : conversation.host_id;
    const profile = partnerProfiles[partnerId];
    if (profile?.name?.trim()) return profile.name;
    if (profile?.email) return profile.email;
    return partnerLabel(conversation) || "Guest";
  }, [role, partnerProfiles, partnerLabel]);

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

  const sortedConversations = useMemo(() => {
    const list = [...conversations];
    list.sort((a, b) => {
      const aTime = a.last_message_at
        ? new Date(a.last_message_at).getTime()
        : bookingMeta[a.booking_id ?? ""]?.createdAt
          ? new Date(bookingMeta[a.booking_id ?? ""]?.createdAt as string).getTime()
          : a.created_at
            ? new Date(a.created_at).getTime()
            : 0;
      const bTime = b.last_message_at
        ? new Date(b.last_message_at).getTime()
        : bookingMeta[b.booking_id ?? ""]?.createdAt
          ? new Date(bookingMeta[b.booking_id ?? ""]?.createdAt as string).getTime()
          : b.created_at
            ? new Date(b.created_at).getTime()
            : 0;
      return bTime - aTime;
    });
    return list;
  }, [conversations, bookingMeta]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sortedConversations.filter((conversation) => {
      const meta = conversation.booking_id ? bookingMeta[conversation.booking_id] : null;
      const status = (meta?.status ?? "").toLowerCase();
      const isArchived = status === "cancelled" || status === "declined" || status === "refunded";
      if (filter === "active" && isArchived) return false;
      if (filter === "archived" && !isArchived) return false;

      if (!query) return true;
      const partner = partnerName(conversation).toLowerCase();
      const title = (meta?.title ?? "").toLowerCase();
      const bookingId = (conversation.booking_id ?? "").toLowerCase();
      return partner.includes(query) || title.includes(query) || bookingId.includes(query);
    });
  }, [sortedConversations, bookingMeta, searchQuery, filter, partnerName]);

  useEffect(() => {
    if (!selectedConversation && filteredConversations.length > 0) {
      setSelectedConversation(filteredConversations[0].id);
      return;
    }
    if (selectedConversation) {
      const exists = filteredConversations.some((c) => c.id === selectedConversation);
      if (!exists) {
        setSelectedConversation(filteredConversations[0]?.id ?? null);
      }
    }
  }, [filteredConversations, selectedConversation]);

  useEffect(() => {
    if (!threadQuery) return;
    const exists = conversations.find((conversation) => conversation.id === threadQuery);
    if (exists) {
      setSelectedConversation(threadQuery);
    }
  }, [threadQuery, conversations]);

  useEffect(() => {
    if (!bookingQuery) return;
    const existing = conversations.find(
      (conversation) => conversation.booking_id === bookingQuery
    );
    if (existing) {
      setSelectedConversation(existing.id);
      return;
    }

    const ensureConversation = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;

        const { data: bookingRow, error: bookingError } = await supabase
          .from("bookings")
          .select("id, host_id, guest_id, status")
          .eq("id", bookingQuery)
          .maybeSingle();
        if (bookingError || !bookingRow) return;
        if (bookingRow.host_id !== userId && bookingRow.guest_id !== userId) return;

        let { data: createdConversation, error: createError } = await supabase
          .from("conversations")
          .upsert(
            {
              booking_id: bookingRow.id,
              host_id: bookingRow.host_id,
              guest_id: bookingRow.guest_id,
            },
            { onConflict: "booking_id" }
          )
          .select("id")
          .single();

        if (createError) {
          const fallback = await supabase
            .from("conversations")
            .insert({
              booking_id: bookingRow.id,
              host_id: bookingRow.host_id,
              guest_id: bookingRow.guest_id,
            })
            .select("id")
            .single();
          createdConversation = fallback.data;
          createError = fallback.error;
        }

        if (createError || !createdConversation?.id) return;
        setSelectedConversation(createdConversation.id);
      } catch (err) {
        console.error("Failed to create conversation for booking", err);
      }
    };

    void ensureConversation();
  }, [bookingQuery, conversations, userId]);

  useEffect(() => {
    if (!threadQuery) return;
    const convo = conversations.find((conversation) => conversation.id === threadQuery);
    if (!convo) return;
    const meta = convo.booking_id ? bookingMeta[convo.booking_id] : null;
    const status = (meta?.status ?? "").toLowerCase();
    const isArchived = status === "cancelled" || status === "declined" || status === "refunded";
    if (isArchived) {
      setFilter("archived");
    }
  }, [threadQuery, conversations, bookingMeta]);

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

      const roleForInsert = role === "host" ? "host" : "guest";
      const payload = {
        conversation_id: selectedConversation,
        body: messageDraft.trim(),
        sender_id: senderId,
        sender_role: roleForInsert,
      };

      let inserted: Message | null = null;
      let insertError: any = null;

      const { data, error } = await supabase
        .from("messages")
        .insert(payload)
        .select("id, sender_id, sender_role, body, created_at")
        .single();
      inserted = data as Message;
      insertError = error;

      if (insertError && isMissingColumn(insertError)) {
        const fallback = await supabase
          .from("messages")
          .insert({
            conversation_id: selectedConversation,
            body: messageDraft.trim(),
            sender_id: senderId,
          })
          .select("id, sender_id, body, created_at")
          .single();
        if (fallback.error) throw fallback.error;
        inserted = fallback.data as Message;
      } else if (insertError) {
        throw insertError;
      }

      if (inserted) {
        setMessages((prev) => [...prev, inserted]);
        cacheLastMessage(selectedConversation, inserted);
        await supabase
          .from("conversations")
          .update({ last_message_at: inserted.created_at })
          .eq("id", selectedConversation);
        await markConversationRead(selectedConversation);
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === selectedConversation
              ? { ...conversation, last_message_at: inserted.created_at }
              : conversation
          )
        );
      }

      setMessageDraft("");
    } catch (err: any) {
      console.error("Failed to send message", err.message ?? err);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSend();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleViewBooking = () => {
    if (!selected?.booking_id) return;
    if (role === "host") {
      router.push(`/host/bookings/${selected.booking_id}`).catch(() => null);
      return;
    }
    router.push(`/guest/bookings/${selected.booking_id}`).catch(() => null);
  };

  const quickReplies =
    role === "host"
      ? [
          "Can you confirm your ETA?",
          "Here are your check-in instructions.",
          "Sharing Wi-Fi details for the stay.",
        ]
      : [
          "Hi, I’m confirming my arrival time.",
          "Could you share check-in details?",
          "Thanks, see you soon.",
        ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)]">
        <aside className="flex flex-col border-r border-slate-200 bg-slate-50">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Messages</h2>
            <p className="mt-1 text-xs text-slate-500">Trip threads by booking</p>
            <div className="mt-3">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search guest, listing, booking ID…"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
              />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setFilter("active")}
                className={cx(
                  "rounded-full border px-3 py-1 text-[11px] font-semibold",
                  filter === "active"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:bg-white"
                )}
              >
                Active
              </button>
              <button
                onClick={() => setFilter("archived")}
                className={cx(
                  "rounded-full border px-3 py-1 text-[11px] font-semibold",
                  filter === "archived"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:bg-white"
                )}
              >
                Archived
              </button>
            </div>
          </div>

          <div className="max-h-[680px] flex-1 overflow-y-auto">
            {loading ? (
              <p className="px-5 py-6 text-sm text-slate-500">Loading threads…</p>
            ) : filteredConversations.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">
                {searchQuery ? "No matching threads." : "No trip threads yet."}
              </p>
            ) : (
              filteredConversations.map((conversation) => {
                const meta = conversation.booking_id ? bookingMeta[conversation.booking_id] : null;
                const last = lastMessages[conversation.id];
                const lastReadAt = readMap[conversation.id] ?? 0;
                const lastMessageAt = conversation.last_message_at
                  ? new Date(conversation.last_message_at).getTime()
                  : 0;
                const unread = lastMessageAt > lastReadAt;
                const status = (meta?.status ?? "").toLowerCase();
                const statusClass = statusStyles[status] ?? "bg-slate-50 text-slate-500 border-slate-200";
                const partner = partnerName(conversation);

                const isSelected = selectedConversation === conversation.id;
                return (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedConversation(conversation.id)}
                    className={cx(
                      "w-full border-b border-slate-100 px-5 py-4 text-left transition hover:bg-white",
                      isSelected && "bg-white shadow-sm border-l-4 border-yellow-400"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-10 w-10 border border-slate-200">
                        <AvatarImage
                          src={
                            partnerProfiles[
                              role === "host" ? conversation.guest_id : conversation.host_id
                            ]?.avatar_url ?? ""
                          }
                        />
                        <AvatarFallback>{partner.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-900">{partner}</p>
                          <span className="text-xs text-slate-400">
                            {last ? formatConversationTimestamp(last.created_at) : ""}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          {formatRange(meta?.checkIn, meta?.checkOut)}
                          {meta?.title ? ` · ${meta.title}` : ""}
                        </p>
                        <p className="text-sm text-slate-500 truncate">
                          {last?.body ?? "Booking summary ready."}
                        </p>
                        <div className="flex items-center gap-2">
                          {status ? (
                            <Badge className={`rounded-full border px-2 py-0.5 text-[10px] ${statusClass}`}>
                              {status.replace(/_/g, " ")}
                            </Badge>
                          ) : null}
                          {unread ? (
                            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-slate-900" />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-[640px] flex-col bg-white">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 border border-slate-200">
                    <AvatarImage src={selectedPartner?.avatar_url ?? ""} />
                    <AvatarFallback>
                      {(selectedPartner?.name ?? selectedPartner?.email ?? "G").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-base font-semibold text-slate-900">
                      {selectedPartner?.name ?? selectedPartner?.email ?? partnerLabel(selected) ?? "Conversation"}
                    </p>
                    <p className="text-sm text-slate-500">
                      {selectedMeta?.title ?? "Listing"} · {formatRange(selectedMeta?.checkIn, selectedMeta?.checkOut)}
                    </p>
                    {selectedMeta?.status ? (
                      <Badge
                        className={`mt-2 rounded-full border px-2 py-0.5 text-[10px] ${
                          statusStyles[selectedMeta.status.toLowerCase()] ??
                          "bg-slate-50 text-slate-500 border-slate-200"
                        }`}
                      >
                        {selectedMeta.status.replace(/_/g, " ")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {selected?.booking_id ? (
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="bg-slate-900 text-white hover:bg-slate-800" onClick={handleViewBooking}>
                      View booking
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="flex-1 overflow-y-auto bg-white px-6 py-6">
                {messages.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                    Trip thread ready. Send check-in details or ask for ETA.
                    <div className="mt-3 flex flex-wrap gap-2">
                      {quickReplies.map((text) => (
                        <button
                          key={text}
                          onClick={() => setMessageDraft(text)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {messages.map((msg) => {
                      const senderRole =
                        msg.sender_role ??
                        (msg.sender_id === selected.host_id
                          ? "host"
                          : msg.sender_id === selected.guest_id
                            ? "guest"
                            : "system");
                      const isSystemBody = msg.body?.toLowerCase().startsWith("booking created");
                      const isSystem =
                        senderRole === "system" || !msg.sender_id || isSystemBody;
                      const bubbleClass = isSystem
                        ? "bg-slate-50 text-slate-600"
                        : senderRole === "host"
                          ? "bg-yellow-50 text-slate-900 border border-yellow-200 shadow-sm"
                          : "bg-slate-100 text-slate-900";
                      const alignClass = isSystem
                        ? "justify-center"
                        : senderRole === "host"
                          ? "justify-end"
                          : "justify-start";

                      return (
                        <div key={msg.id} className={cx("flex", alignClass)}>
                          <div
                            className={cx(
                              "max-w-[70%] rounded-xl px-4 py-3 text-sm",
                              bubbleClass,
                              isSystem && "border border-slate-200 text-center"
                            )}
                          >
                            <p className="leading-snug whitespace-pre-wrap">{msg.body}</p>
                            {!isSystem ? (
                              <p className="mt-2 text-xs text-slate-400">
                                {formatMessageTime(msg.created_at)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={endRef} />
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSubmit}
                className="border-t border-slate-200 bg-white px-6 py-4"
              >
                <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-sm">
                  <Textarea
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Write a message…"
                    rows={2}
                    className="flex-1 min-h-[44px] resize-none border-0 bg-transparent p-0 text-sm focus:outline-none focus:ring-0"
                  />
                  <button
                    type="submit"
                    disabled={sending || !messageDraft.trim()}
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-400 text-slate-900 transition hover:bg-yellow-500 disabled:opacity-60"
                    aria-label="Send message"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
              Select a thread to start messaging.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
