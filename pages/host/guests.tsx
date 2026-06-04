import { useCallback, useEffect, useMemo, useState } from "react";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import { HostPageHeader } from "@/components/host/HostPageHeader";
import GuestProfilePreviewCard from "@/components/profile/GuestProfilePreviewCard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { BookingDrawer } from "@/components/calendar/BookingDrawer";
import { MessagingTray } from "@/components/host/MessagingTray";
import { ensureProfile } from "@/lib/ensureProfile";
import { formatCurrency, formatRangeSummary } from "@/lib/dateUtils";
import { supabase } from "@/lib/supabaseClient";
import type { LinearCalendarEvent, BookingStatus } from "@/lib/calendarTypes";

const statusStyles: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  awaiting_payment: "bg-slate-50 text-slate-600 border-slate-200",
  payment_failed: "bg-rose-50 text-rose-700 border-rose-200",
  declined: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-50 text-slate-400 border-slate-200 line-through",
};

const verificationStyles: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  unverified: "bg-slate-50 text-slate-500 border-slate-200",
};

type HostBookingRow = {
  id: string;
  listing_id: string | null;
  guest_id: string | null;
  status: BookingStatus | string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  guests_total?: number | null;
  guest_total_pence?: number | null;
  price_total?: number | null;
  currency?: string | null;
  stay_type?: string | null;
  channel?: string | null;
  created_at?: string | null;
};

type GuestProfile = {
  id: string;
  full_name: string | null;
  headline?: string | null;
  bio?: string | null;
  avatar_url: string | null;
  verification_level: number | null;
  verification_status: string | null;
};

type ListingRow = {
  id: string;
  title: string | null;
};

type HostBookingNote = {
  id: string;
  booking_id: string;
  note: string;
  created_at: string;
};

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

const isMissingTable = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42p01" || message.includes("relation") || message.includes("host_booking_notes");
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const resolveVerification = (profile?: GuestProfile | null) => {
  const raw = (profile?.verification_status ?? "").toLowerCase();
  if (raw === "verified" || raw === "pending" || raw === "rejected") return raw;
  if ((profile?.verification_level ?? 0) >= 1) return "verified";
  return "unverified";
};

export default function HostGuestsPage() {
  const [hostId, setHostId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<HostBookingRow[]>([]);
  const [guests, setGuests] = useState<Record<string, GuestProfile>>({});
  const [listings, setListings] = useState<Record<string, ListingRow>>({});
  const [notes, setNotes] = useState<Record<string, HostBookingNote[]>>({});
  const [notesAvailable, setNotesAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerEvent, setDrawerEvent] = useState<LinearCalendarEvent | null>(null);

  const [messageTrayOpen, setMessageTrayOpen] = useState(false);
  const [messageConversationId, setMessageConversationId] = useState<string | null>(null);
  const [messageGuestName, setMessageGuestName] = useState<string | null>(null);
  const [messageBookingLabel, setMessageBookingLabel] = useState<string | null>(null);

  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBookingId, setNoteBookingId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setLoading(false);
      return;
    }

    setHostId(user.id);
    await ensureProfile();

    const bookingSelects = [
      "id, listing_id, guest_id, status, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, price_total, currency, stay_type, channel, created_at",
      "id, listing_id, guest_id, status, check_in_time, check_out_time, guests_total, guest_total_pence, price_total, currency, stay_type, channel, created_at",
      "id, listing_id, guest_id, status, check_in, check_out, guests_total, price_total, currency, created_at",
    ];

    let bookingRows: HostBookingRow[] = [];
    let bookingError: any = null;

    for (const select of bookingSelects) {
      const { data, error } = await supabase
        .from("bookings")
        .select(select)
        .eq("host_id", user.id)
        .order("check_in_time", { ascending: true })
        .order("check_in", { ascending: true })
        .limit(150);

      bookingRows = (data as unknown as HostBookingRow[]) ?? [];
      bookingError = error;

      if (!bookingError) break;
      if (!isMissingColumn(bookingError)) break;
    }

    if (bookingError) {
      setError(bookingError.message ?? "Unable to load bookings.");
      setBookings([]);
      setLoading(false);
      return;
    }

    setBookings(bookingRows ?? []);

    const guestIds = Array.from(
      new Set((bookingRows ?? []).map((row) => row.guest_id).filter(Boolean))
    ) as string[];
    const listingIds = Array.from(
      new Set((bookingRows ?? []).map((row) => row.listing_id).filter(Boolean))
    ) as string[];

    if (guestIds.length > 0) {
      const { data: guestRows, error: guestError } = await supabase
        .from("profiles")
        .select("id, full_name, headline, bio, avatar_url, verification_level, verification_status")
        .in("id", guestIds);

      if (!guestError && guestRows) {
        const guestLookup = (guestRows as GuestProfile[]).reduce<Record<string, GuestProfile>>(
          (acc, row) => {
            acc[row.id] = row;
            return acc;
          },
          {}
        );
        setGuests(guestLookup);
      }
    }

    if (listingIds.length > 0) {
      const { data: listingRows, error: listingError } = await supabase
        .from("listings")
        .select("id, title")
        .in("id", listingIds);
      if (!listingError && listingRows) {
        const listingLookup = (listingRows as ListingRow[]).reduce<Record<string, ListingRow>>(
          (acc, row) => {
            acc[row.id] = row;
            return acc;
          },
          {}
        );
        setListings(listingLookup);
      }
    }

    if (bookingRows.length > 0) {
      const bookingIds = bookingRows.map((row) => row.id);
      const { data: noteRows, error: noteError } = await supabase
        .from("host_booking_notes")
        .select("id, booking_id, note, created_at")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: false });

      if (noteError) {
        if (isMissingTable(noteError)) {
          setNotesAvailable(false);
        } else {
          console.warn("Failed to load host notes", noteError.message);
        }
      } else if (noteRows) {
        const noteLookup = (noteRows as HostBookingNote[]).reduce<Record<string, HostBookingNote[]>>(
          (acc, row) => {
            acc[row.booking_id] = acc[row.booking_id] ?? [];
            acc[row.booking_id].push(row);
            return acc;
          },
          {}
        );
        setNotes(noteLookup);
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const handleOpenDrawer = useCallback(
    (booking: HostBookingRow) => {
      const guest = booking.guest_id ? guests[booking.guest_id] : null;
      const listingTitle = booking.listing_id ? listings[booking.listing_id]?.title : null;
      const startRaw = booking.check_in_time ?? booking.check_in ?? "";
      const endRaw = booking.check_out_time ?? booking.check_out ?? "";
      const start = new Date(startRaw);
      const end = new Date(endRaw);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
      const totalMajor =
        booking.guest_total_pence != null
          ? booking.guest_total_pence / 100
          : booking.price_total ?? null;
      const event: LinearCalendarEvent = {
        id: booking.id,
        listingId: booking.listing_id ?? "",
        start,
        end,
        label: guest?.full_name ?? "Guest",
        color: "#0f172a",
        source: "booking",
          meta: {
            kind: "booking",
            status: (booking.status ?? "awaiting_payment") as BookingStatus,
            total: totalMajor ?? null,
            currency: booking.currency ?? "GBP",
            nights: Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000)),
            guestName: guest?.full_name ?? "Guest",
            guestEmail: null,
            listingName: listingTitle ?? null,
            guests: booking.guests_total ?? null,
          },
      };
      setDrawerEvent(event);
      setDrawerOpen(true);
    },
    [guests, listings]
  );

  const handleCancelBooking = useCallback(
    async (bookingId: string) => {
      const confirmCancel = window.confirm(
        "Cancel this booking? Guests will be notified and dates will reopen."
      );
      if (!confirmCancel) return;
      const { error: updateError } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", bookingId);
      if (updateError) {
        alert(updateError.message ?? "Unable to cancel booking.");
        return;
      }
      await loadBookings();
    },
    [loadBookings]
  );

  const handleMessageGuest = useCallback(
    async (booking: HostBookingRow) => {
      if (!booking?.id) return;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          alert("Please sign in to message guests.");
          return;
        }

        let conversationId: string | null = null;

        const { data: existingConversation, error: existingError } = await supabase
          .from("conversations")
          .select("id")
          .eq("booking_id", booking.id)
          .maybeSingle();

        if (existingError) {
          console.error("Failed to check conversation", existingError.message);
        }

        if (existingConversation?.id) {
          conversationId = existingConversation.id;
        } else {
          const { data: bookingRow, error: bookingError } = await supabase
            .from("bookings")
            .select("id, host_id, guest_id")
            .eq("id", booking.id)
            .maybeSingle();

          if (bookingError || !bookingRow?.host_id || !bookingRow?.guest_id) {
            console.error("Unable to resolve booking participants", bookingError?.message);
            alert("Unable to start a conversation for this booking.");
            return;
          }

          const { data: createdConversation, error: createError } = await supabase
            .from("conversations")
            .insert({
              booking_id: booking.id,
              host_id: bookingRow.host_id,
              guest_id: bookingRow.guest_id,
            })
            .select("id")
            .single();

          if (createError || !createdConversation?.id) {
            console.error("Failed to create conversation", createError?.message);
            alert("Unable to start a conversation for this booking.");
            return;
          }

          conversationId = createdConversation.id;
        }

        const guest = booking.guest_id ? guests[booking.guest_id] : null;
        const startRaw = booking.check_in_time ?? booking.check_in ?? "";
        const endRaw = booking.check_out_time ?? booking.check_out ?? "";
        const start = new Date(startRaw);
        const end = new Date(endRaw);
        setMessageConversationId(conversationId);
        setMessageGuestName(guest?.full_name ?? "Guest");
        setMessageBookingLabel(
          Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
            ? null
            : formatRangeSummary(start, end)
        );
        setMessageTrayOpen(true);
      } catch (err) {
        console.error("Failed to open message tray", err);
      }
    },
    [guests]
  );

  const handleAddNote = useCallback((bookingId: string) => {
    setNoteBookingId(bookingId);
    setNoteDraft("");
    setNoteDialogOpen(true);
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (!noteBookingId || !noteDraft.trim() || !hostId) return;
    setSavingNote(true);
    const payload = {
      booking_id: noteBookingId,
      host_id: hostId,
      note: noteDraft.trim(),
    };

    const { data, error: noteError } = await supabase
      .from("host_booking_notes")
      .insert(payload)
      .select("id, booking_id, note, created_at")
      .single();

    if (noteError) {
      alert(noteError.message ?? "Unable to save note.");
      setSavingNote(false);
      return;
    }

    if (data) {
      setNotes((prev) => {
        const next = { ...prev };
        next[noteBookingId] = [data as HostBookingNote, ...(next[noteBookingId] ?? [])];
        return next;
      });
    }

    setSavingNote(false);
    setNoteDialogOpen(false);
  }, [hostId, noteBookingId, noteDraft]);

  const bookingRows = useMemo(() => bookings ?? [], [bookings]);

  return (
    <HostShellLayout title="Bookings & Guests" activeNav="guests">
      <div className="space-y-8">
        <HostPageHeader
          title="Bookings & Guests"
          description="Manage upcoming stays, contact guests, and track verification at a glance."
          actions={
            <Button
              size="sm"
              onClick={loadBookings}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
            >
              Refresh
            </Button>
          }
        />

        <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1.6fr_1.1fr_1fr_0.9fr_1.2fr] gap-4 border-b border-slate-200 bg-slate-50 px-6 py-3 text-xs uppercase tracking-wider text-slate-500">
            <span>Guest</span>
            <span>Dates</span>
            <span>Status</span>
            <span>Total</span>
            <span>Actions</span>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-sm text-slate-500">Loading bookings…</div>
          ) : error ? (
            <div className="px-6 py-8 text-sm text-rose-600">{error}</div>
          ) : bookingRows.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-500">No bookings yet.</div>
          ) : (
            <div>
              {bookingRows.map((booking) => {
                const guestProfile = booking.guest_id ? guests[booking.guest_id] : null;
                const listing = booking.listing_id ? listings[booking.listing_id] : null;
                const status = (booking.status ?? "awaiting_payment").toLowerCase();
                const statusClass = statusStyles[status] ?? "bg-slate-50 text-slate-600 border-slate-200";
                const checkIn = booking.check_in_time ?? booking.check_in;
                const checkOut = booking.check_out_time ?? booking.check_out;
                const totalMajor =
                  booking.guest_total_pence != null
                    ? booking.guest_total_pence / 100
                    : booking.price_total ?? null;
                const totalLabel = totalMajor != null ? formatCurrency(totalMajor, booking.currency) : "—";
                const verification = resolveVerification(guestProfile);
                const verificationClass =
                  verificationStyles[verification] ?? "bg-slate-50 text-slate-500 border-slate-200";
                const latestNote = notes[booking.id]?.[0]?.note ?? null;

                return (
                  <div
                    key={booking.id}
                    className="grid grid-cols-[1.6fr_1.1fr_1fr_0.9fr_1.2fr] gap-4 border-b border-slate-100 px-6 py-3 text-sm hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <GuestProfilePreviewCard
                        compact
                        profile={guestProfile}
                        secondaryBadge={{
                          label:
                            verification === "verified"
                              ? "Verified"
                              : verification === "pending"
                              ? "Pending"
                              : verification === "rejected"
                              ? "Rejected"
                              : "Unverified",
                          tone:
                            verification === "verified"
                              ? "verified"
                              : verification === "pending"
                              ? "pending"
                              : verification === "rejected"
                              ? "rejected"
                              : "default",
                        }}
                        meta={
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span>{listing?.title ?? "Listing"}</span>
                            {latestNote ? <span className="line-clamp-1">Note: {latestNote}</span> : null}
                          </div>
                        }
                      />
                    </div>

                    <div className="text-sm text-slate-600">
                      <div>{formatDate(checkIn)}</div>
                      <div className="text-xs text-slate-400">to {formatDate(checkOut)}</div>
                    </div>

                    <div>
                      <Badge className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
                        {status.replace(/_/g, " ")}
                      </Badge>
                    </div>

                    <div className="text-sm font-semibold text-slate-900">{totalLabel ?? "—"}</div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleMessageGuest(booking)}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                      >
                        Message
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleOpenDrawer(booking)}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                      >
                        View
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleCancelBooking(booking.id)}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                      >
                        Cancel
                      </Button>
                      {notesAvailable ? (
                        <Button
                          size="sm"
                          onClick={() => handleAddNote(booking.id)}
                          className="rounded-xl border border-transparent bg-transparent px-3 py-2 text-slate-600 hover:bg-slate-100"
                        >
                          Add note
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {!notesAvailable ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-700">
            Notes storage is not configured. Create the `host_booking_notes` table to enable internal notes.
          </Card>
        ) : null}
      </div>

      <BookingDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        event={drawerEvent}
        onMessageGuest={(event) => {
          const target = bookings.find((row) => row.id === event.id);
          if (target) handleMessageGuest(target);
        }}
        onCancelBooking={(event) => handleCancelBooking(event.id)}
      />

      <MessagingTray
        open={messageTrayOpen}
        onOpenChange={setMessageTrayOpen}
        conversationId={messageConversationId}
        guestName={messageGuestName}
        bookingLabel={messageBookingLabel}
      />

      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Add internal note</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Add a private note about this guest or stay."
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            rows={4}
          />
          <DialogFooter className="mt-4 flex items-center justify-end gap-2">
            <Button
              size="sm"
              onClick={() => setNoteDialogOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveNote}
              disabled={savingNote || !noteDraft.trim()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
            >
              {savingNote ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </HostShellLayout>
  );
}
