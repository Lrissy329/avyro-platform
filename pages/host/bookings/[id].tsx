import type { GetServerSideProps } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import { HostPageHeader } from "@/components/host/HostPageHeader";
import { isPaidFinalBookingStatus } from "@/lib/bookingStatus";
import GuestProfilePreviewCard from "@/components/profile/GuestProfilePreviewCard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabaseClient";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { ReviewFormModal } from "@/components/reviews/ReviewFormModal";

type BookingRow = {
  id: string;
  listing_id: string | null;
  guest_id: string | null;
  host_id: string | null;
  status: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  guests_total?: number | null;
  guest_total_pence?: number | null;
  host_net_total_pence?: number | null;
  platform_fee_bps?: number | null;
  platform_fee_capped?: boolean | null;
  stripe_var_bps?: number | null;
  stripe_fixed_pence?: number | null;
  stripe_status?: string | null;
  stripe_payment_intent_id?: string | null;
  payout_status?: string | null;
  payout_released_at?: string | null;
  payout_transfer_id?: string | null;
  price_total?: number | null;
  currency?: string | null;
  stay_type?: string | null;
  channel?: string | null;
  created_at?: string | null;
};

type ListingRow = {
  id: string;
  title: string | null;
  location: string | null;
  photos?: string[] | null;
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

type PageProps = {
  booking: BookingRow | null;
  listing: ListingRow | null;
  guest: GuestProfile | null;
  conversationId: string | null;
  hostNote: string | null;
  stripeMeta: {
    accountId: string | null;
    onboardingStatus: string | null;
  };
};

type ReviewEligibility = {
  canGuestReview: boolean;
  canHostReview: boolean;
  guestAlreadyReviewed: boolean;
  hostAlreadyReviewed: boolean;
  reviewWindowExpiresAt: string | null;
};

const statusStyles: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  awaiting_payment: "bg-amber-50 text-amber-700 border-amber-200",
  pending_payment: "bg-amber-50 text-amber-700 border-amber-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
  declined: "bg-red-50 text-red-600 border-red-200",
  completed: "bg-slate-100 text-slate-600 border-slate-200",
};

const verificationStyles: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  unverified: "bg-slate-50 text-slate-500 border-slate-200",
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

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const supabase = createPagesServerClient(ctx);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return {
      redirect: {
        destination: `/login?redirect=${encodeURIComponent(ctx.resolvedUrl)}`,
        permanent: false,
      },
    };
  }

  const bookingId = typeof ctx.params?.id === "string" ? ctx.params?.id : null;
  if (!bookingId) {
    return { notFound: true };
  }

  const admin = getSupabaseServerClient();

  const bookingSelects = [
    "id, listing_id, guest_id, host_id, status, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, host_net_total_pence, platform_fee_bps, platform_fee_capped, stripe_var_bps, stripe_fixed_pence, stripe_status, stripe_payment_intent_id, payout_status, payout_released_at, payout_transfer_id, stay_type, channel, created_at, currency",
    "id, listing_id, guest_id, host_id, status, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, host_net_total_pence, platform_fee_bps, stripe_var_bps, stripe_fixed_pence, stripe_status, stripe_payment_intent_id, payout_status, payout_released_at, payout_transfer_id, stay_type, channel, created_at, currency",
    "id, listing_id, guest_id, host_id, status, check_in_time, check_out_time, check_in, check_out, guests_total, price_total, stay_type, channel, created_at, currency",
    "id, listing_id, guest_id, host_id, status, check_in, check_out, guests_total, price_total, stay_type, channel, created_at, currency",
  ];

  let bookingRow: BookingRow | null = null;
  let bookingError: any = null;

  for (const select of bookingSelects) {
    const { data, error } = await admin
      .from("bookings")
      .select(select)
      .eq("id", bookingId)
      .maybeSingle();
    bookingRow = (data as unknown as BookingRow) ?? null;
    bookingError = error;
    if (!bookingError) break;
    if (!isMissingColumn(bookingError)) break;
  }

  if (bookingError || !bookingRow) {
    return { notFound: true };
  }

  if (bookingRow.host_id !== session.user.id) {
    return { notFound: true };
  }

  let listing: ListingRow | null = null;
  if (bookingRow.listing_id) {
    const { data: listingRow } = await admin
      .from("listings")
      .select("id, title, location, photos")
      .eq("id", bookingRow.listing_id)
      .maybeSingle();
    listing = (listingRow as ListingRow) ?? null;
  }

  let guest: GuestProfile | null = null;
  if (bookingRow.guest_id) {
    const guestSelects = [
      "id, full_name, headline, bio, avatar_url, verification_level, verification_status",
      "id, full_name, avatar_url, verification_level, verification_status",
    ];
    for (const select of guestSelects) {
      const { data: guestRow, error: guestError } = await admin
        .from("profiles")
        .select(select)
        .eq("id", bookingRow.guest_id)
        .maybeSingle();
      guest = (guestRow as unknown as GuestProfile) ?? null;
      if (!guestError) break;
      if (!isMissingColumn(guestError)) break;
    }
  }

  const { data: conversationRow } = await admin
    .from("conversations")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle();

  let hostNote: string | null = null;
  const { data: noteRows, error: noteError } = await admin
    .from("host_booking_notes")
    .select("note, created_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!noteError && noteRows && noteRows.length > 0) {
    hostNote = noteRows[0]?.note ?? null;
  } else if (noteError && !isMissingTable(noteError)) {
    console.warn("[host booking] failed to load notes", noteError.message);
  }

  const { data: stripeRow } = await admin
    .from("profiles")
    .select("stripe_account_id, stripe_onboarding_status")
    .eq("id", session.user.id)
    .maybeSingle();

  return {
    props: {
      booking: bookingRow,
      listing,
      guest,
      conversationId: conversationRow?.id ?? null,
      hostNote,
      stripeMeta: {
        accountId: (stripeRow as any)?.stripe_account_id ?? null,
        onboardingStatus: (stripeRow as any)?.stripe_onboarding_status ?? null,
      },
    },
  };
};

export default function HostBookingDetailPage({
  booking,
  listing,
  guest,
  conversationId,
  hostNote,
  stripeMeta,
}: PageProps) {
  const router = useRouter();
  const [noteDraft, setNoteDraft] = useState(hostNote ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [localStatus, setLocalStatus] = useState(booking?.status ?? null);
  const [localConversationId, setLocalConversationId] = useState(conversationId);
  const [canceling, setCanceling] = useState(false);
  const [connectingStripe, setConnectingStripe] = useState(false);
  const [reviewEligibility, setReviewEligibility] = useState<ReviewEligibility | null>(null);
  const [loadingReviewEligibility, setLoadingReviewEligibility] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const status = (localStatus ?? booking?.status ?? "").toLowerCase();
  const statusClass = statusStyles[status] ?? "bg-slate-50 text-slate-500 border-slate-200";
  const verification = resolveVerification(guest);
  const verificationClass =
    verificationStyles[verification] ?? "bg-slate-50 text-slate-500 border-slate-200";

  const shortId = booking?.id ? `BK-${booking.id.slice(-4).toUpperCase()}` : "Booking";

  const checkIn = booking?.check_in_time ?? booking?.check_in ?? null;
  const checkOut = booking?.check_out_time ?? booking?.check_out ?? null;
  const summaryRange = `${formatDate(checkIn)} → ${formatDate(checkOut)}`;

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return "—";
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
    const diff = Math.ceil((end.getTime() - start.getTime()) / 86400000);
    return diff;
  }, [checkIn, checkOut]);

  const guestTotalPence =
    booking?.guest_total_pence ?? (booking?.price_total != null ? Math.round(booking.price_total * 100) : null);
  const hostNetPence = booking?.host_net_total_pence ?? null;
  const platformFeeBps = booking?.platform_fee_bps ?? null;
  const stripeVarBps = booking?.stripe_var_bps ?? null;
  const stripeFixedPence = booking?.stripe_fixed_pence ?? null;
  const stripeFeeEstimate =
    guestTotalPence != null && stripeVarBps != null && stripeFixedPence != null
      ? Math.floor((guestTotalPence * stripeVarBps) / 10000) + stripeFixedPence
      : null;

  const canCancel =
    status === "awaiting_payment" ||
    status === "pending_payment" ||
    isPaidFinalBookingStatus(status);

  const loadReviewEligibility = useCallback(async () => {
    if (!booking?.id) return;
    setLoadingReviewEligibility(true);
    try {
      const response = await fetch(
        `/api/reviews/eligibility?bookingId=${encodeURIComponent(booking.id)}`
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load review eligibility.");
      }
      setReviewEligibility(payload as ReviewEligibility);
    } catch (error) {
      console.error("[host booking detail] failed to load review eligibility", error);
    } finally {
      setLoadingReviewEligibility(false);
    }
  }, [booking?.id]);

  useEffect(() => {
    loadReviewEligibility().catch(() => null);
  }, [loadReviewEligibility]);

  const handleMessageGuest = useCallback(async () => {
    if (!booking?.id || !booking.host_id || !booking.guest_id) return;
    if (localConversationId) {
      router.push(`/host/messages?thread=${localConversationId}`).catch(() => null);
      return;
    }
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        booking_id: booking.id,
        host_id: booking.host_id,
        guest_id: booking.guest_id,
      })
      .select("id")
      .single();
    if (!error && data?.id) {
      setLocalConversationId(data.id);
      router.push(`/host/messages?thread=${data.id}`).catch(() => null);
    }
  }, [booking, localConversationId, router]);

  const handleCancel = useCallback(async () => {
    if (!booking?.id || !canCancel) return;
    const confirmed = window.confirm(
      "Cancel this booking? This will release the dates and notify the guest."
    );
    if (!confirmed) return;
    setCanceling(true);
    try {
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id);
      if (error) throw error;
      setLocalStatus("cancelled");

      let threadId = localConversationId;
      if (!threadId && booking.host_id && booking.guest_id) {
        const { data } = await supabase
          .from("conversations")
          .upsert(
            {
              booking_id: booking.id,
              host_id: booking.host_id,
              guest_id: booking.guest_id,
            },
            { onConflict: "booking_id" }
          )
          .select("id")
          .single();
        threadId = data?.id ?? null;
        setLocalConversationId(threadId);
      }

      if (threadId) {
        const payload = {
          conversation_id: threadId,
          sender_id: null,
          sender_role: "system",
          body: "Host cancelled booking.",
        };
        const { data: messageRow, error: messageError } = await supabase
          .from("messages")
          .insert(payload)
          .select("id, created_at")
          .single();
        if (messageError) {
          const fallback = await supabase
            .from("messages")
            .insert({
              conversation_id: threadId,
              sender_id: booking.host_id,
              body: "Host cancelled booking.",
            })
            .select("id, created_at")
            .single();
          if (fallback.data?.created_at) {
            await supabase
              .from("conversations")
              .update({ last_message_at: fallback.data.created_at })
              .eq("id", threadId);
          }
        } else if (messageRow?.created_at) {
          await supabase
            .from("conversations")
            .update({ last_message_at: messageRow.created_at })
            .eq("id", threadId);
        }
      }
    } catch (err: any) {
      alert(err?.message ?? "Unable to cancel booking.");
    } finally {
      setCanceling(false);
    }
  }, [booking, canCancel, localConversationId]);

  const handleSaveNote = useCallback(async () => {
    if (!booking?.id || !booking.host_id || !noteDraft.trim()) return;
    setSavingNote(true);
    try {
      const { error } = await supabase
        .from("host_booking_notes")
        .insert({
          booking_id: booking.id,
          host_id: booking.host_id,
          note: noteDraft.trim(),
        });
      if (error) throw error;
    } catch (err: any) {
      alert(err?.message ?? "Unable to save note.");
    } finally {
      setSavingNote(false);
    }
  }, [booking, noteDraft]);

  const handleConnectStripe = useCallback(async () => {
    setConnectingStripe(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error("Please sign in again.");

      const response = await fetch("/api/stripe/create-account-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Unable to start onboarding.");
      if (payload?.url) {
        window.location.assign(payload.url);
      }
    } catch (err: any) {
      alert(err?.message ?? "Unable to start Stripe onboarding.");
    } finally {
      setConnectingStripe(false);
    }
  }, []);

  const paymentIntentShort = booking?.stripe_payment_intent_id
    ? booking.stripe_payment_intent_id.slice(-6)
    : null;

  const stripeConnected = stripeMeta.onboardingStatus === "complete";

  const timelineItems = useMemo(() => {
    const items: Array<{ label: string; time?: string | null }> = [];
    items.push({ label: "Booking created", time: booking?.created_at ?? null });
    if (status === "awaiting_payment" || status === "pending_payment") {
      items.push({ label: "Payment pending", time: booking?.created_at ?? null });
    }
    if (booking?.stripe_status && ["paid", "succeeded"].includes(booking.stripe_status)) {
      items.push({ label: "Payment succeeded", time: booking?.created_at ?? null });
    }
    if (isPaidFinalBookingStatus(status)) {
      items.push({ label: "Confirmed", time: booking?.created_at ?? null });
    }
    if (status === "cancelled") {
      items.push({ label: "Cancelled", time: booking?.created_at ?? null });
    }
    if (booking?.payout_released_at) {
      items.push({ label: "Payout released", time: booking.payout_released_at });
    }
    if (status === "completed") {
      items.push({ label: "Completed", time: booking?.check_out_time ?? booking?.check_out ?? null });
    }
    return items;
  }, [booking, status]);

  if (!booking) {
    return (
      <HostShellLayout title="Booking" activeNav="guests">
        <div className="space-y-8">
          <HostPageHeader
            title="Booking detail"
            description="Review booking status, guest verification, and payment details."
          />
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-500">
            Booking not found.
          </Card>
        </div>
      </HostShellLayout>
    );
  }

  return (
    <HostShellLayout title="Booking" activeNav="guests">
      <div className="space-y-8">
        <HostPageHeader
          title="Booking detail"
          description="Review booking status, guest verification, and payment details."
        />

        <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Link href="/host/messages" className="text-xs text-slate-500 hover:text-slate-700">
                ← Back to messages
              </Link>
              <p className="mt-2 text-sm font-semibold text-slate-900">{shortId}</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-900">{listing?.title ?? "Listing"}</p>
              <p className="text-xs text-slate-500">{listing?.location ?? ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
                {status.replace(/_/g, " ") || "pending"}
              </Badge>
              <Button
                size="sm"
                onClick={handleMessageGuest}
                className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
              >
                Message guest
              </Button>
              {canCancel ? (
                <Button
                  size="sm"
                  onClick={handleCancel}
                  disabled={canceling}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                >
                  {canceling ? "Cancelling…" : "Cancel booking"}
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Booking summary</h3>
              <div className="mt-4 grid gap-3 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Check-in</span>
                  <span className="font-semibold text-slate-900">{formatDate(checkIn)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Check-out</span>
                  <span className="font-semibold text-slate-900">{formatDate(checkOut)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Nights</span>
                  <span className="font-semibold text-slate-900">{nights}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Guests</span>
                  <span className="font-semibold text-slate-900">{booking.guests_total ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Stay type</span>
                  <span className="font-semibold text-slate-900">{booking.stay_type ?? "nightly"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Channel</span>
                  <span className="font-semibold text-slate-900">{booking.channel ?? "direct"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Created</span>
                  <span className="font-semibold text-slate-900">{formatDate(booking.created_at)}</span>
                </div>
              </div>
            </Card>

            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Guest</h3>
                <Button
                  size="sm"
                  onClick={handleMessageGuest}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                >
                  Message guest
                </Button>
              </div>
              <div className="mt-4">
                <GuestProfilePreviewCard
                  profile={guest}
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
                    <p className="text-xs text-slate-500">
                      Hosts only see public profile details that help assess the stay fit.
                    </p>
                  }
                />
              </div>
            </Card>

            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Internal note</h3>
              <p className="mt-1 text-xs text-slate-500">
                Notes are visible only to you and your team.
              </p>
              <Textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Add a private note about this booking…"
                rows={4}
                className="mt-4"
              />
              <div className="mt-3">
                <Button
                  onClick={handleSaveNote}
                  disabled={savingNote || !noteDraft.trim()}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
                >
                  {savingNote ? "Saving…" : "Save note"}
                </Button>
              </div>
            </Card>

            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">How was your guest?</h3>
              <p className="mt-1 text-xs text-slate-500">
                Reviews are published once both sides submit, or after the review window closes.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                {loadingReviewEligibility ? (
                  <p className="text-slate-500">Checking review eligibility…</p>
                ) : reviewEligibility?.hostAlreadyReviewed ? (
                  <p className="font-semibold text-emerald-700">You already reviewed this guest.</p>
                ) : reviewEligibility?.canHostReview ? (
                  <>
                    <p className="text-slate-600">
                      Share trust feedback for this guest to help improve stay quality.
                    </p>
                    <Button
                      onClick={() => setReviewModalOpen(true)}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
                    >
                      Leave guest review
                    </Button>
                  </>
                ) : (
                  <p className="text-slate-500">
                    {reviewEligibility?.reviewWindowExpiresAt
                      ? `Review window closed on ${formatDate(reviewEligibility.reviewWindowExpiresAt)}.`
                      : "Review window unavailable for this booking."}
                  </p>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Payment & payout</h3>
                {!stripeConnected ? (
                  <Button
                    size="sm"
                    onClick={handleConnectStripe}
                    disabled={connectingStripe}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                  >
                    Complete payouts setup
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Guest total</span>
                  <span className="font-semibold text-slate-900">
                    {guestTotalPence != null ? `£${(guestTotalPence / 100).toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Host net total</span>
                  <span className="font-semibold text-slate-900">
                    {hostNetPence != null ? `£${(hostNetPence / 100).toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Platform fee tier</span>
                  <span className="font-semibold text-slate-900">
                    {platformFeeBps != null ? `${(platformFeeBps / 100).toFixed(0)}%` : "—"}
                  </span>
                </div>
                {booking.platform_fee_capped ? (
                  <Badge className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
                    Platform fee capped
                  </Badge>
                ) : null}
                {stripeFeeEstimate != null ? (
                  <div className="flex items-center justify-between">
                    <span>Stripe processing est.</span>
                    <span className="font-semibold text-slate-900">
                      £{(stripeFeeEstimate / 100).toFixed(2)}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between">
                  <span>Payment status</span>
                  <span className="font-semibold text-slate-900">{booking.stripe_status ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>PaymentIntent</span>
                  <span className="font-semibold text-slate-900">
                    {paymentIntentShort ? `…${paymentIntentShort}` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Payout status</span>
                  <span className="font-semibold text-slate-900">{booking.payout_status ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Payout released</span>
                  <span className="font-semibold text-slate-900">
                    {formatDate(booking.payout_released_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Payout transfer</span>
                  <span className="font-semibold text-slate-900">
                    {booking.payout_transfer_id ?? "—"}
                  </span>
                </div>
              </div>
            </Card>

            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Booking timeline</h3>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                {timelineItems.map((item) => (
                  <div key={`${item.label}-${item.time ?? ""}`} className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-slate-900" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                      <p className="text-xs text-slate-500">{formatDate(item.time)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <ReviewFormModal
          open={reviewModalOpen}
          onOpenChange={setReviewModalOpen}
          bookingId={booking.id}
          mode="host_to_guest"
          subjectLabel={guest?.full_name ?? "guest"}
          onSubmitted={() => {
            loadReviewEligibility().catch(() => null);
          }}
        />
      </div>
    </HostShellLayout>
  );
}
