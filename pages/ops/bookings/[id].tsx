import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import OpsErrorPanel from "@/components/ops/OpsErrorPanel";
import OpsLayout from "@/components/ops/OpsLayout";
import OpsStatusBadge from "@/components/ops/OpsStatusBadge";
import { requireOpsStaff } from "@/lib/opsAuth";
import { hasOpsPermission, type OpsRole } from "@/lib/opsRbac";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type BookingDetail = {
  id: string;
  listing_id: string | null;
  guest_id: string | null;
  host_id: string | null;
  status: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  price_total: number | null;
  currency: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_status?: string | null;
  host_net_total_pence?: number | null;
  guest_total_pence?: number | null;
  guest_unit_price_pence?: number | null;
  platform_fee_bps?: number | null;
  stripe_var_bps?: number | null;
  stripe_fixed_pence?: number | null;
  pricing_version?: string | null;
  needs_review?: boolean | null;
  payout_status?: string | null;
  payout_transfer_id?: string | null;
  payout_released_at?: string | null;
  created_at?: string | null;
};

type BookingNote = {
  id: string;
  note: string;
  created_at: string;
  staff_user_id: string;
};

type ProfileSummary = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ListingSummary = {
  id: string;
  title: string | null;
  location: string | null;
};

type PageProps = {
  booking: BookingDetail;
  notes: BookingNote[];
  guest: ProfileSummary | null;
  host: ProfileSummary | null;
  listing: ListingSummary | null;
  staffRole: OpsRole;
  errors: string[];
};

const BOOKING_DETAIL_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return BOOKING_DETAIL_DATE_TIME.format(date);
};

const formatCurrencyPence = (value?: number | null, currency = "GBP") => {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
};

const formatCurrencyMajor = (value?: number | null, currency = "GBP") => {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
};

const statusTone = (value?: string | null): "default" | "warning" | "danger" | "success" | "info" => {
  const status = String(value ?? "").toLowerCase();
  if (["confirmed", "paid"].includes(status)) return "success";
  if (["awaiting_payment", "pending_payment", "pending", "scheduled"].includes(status)) return "warning";
  if (["cancelled", "rejected", "payment_failed", "failed", "refunded"].includes(status)) {
    return "danger";
  }
  return "default";
};

const TABS = ["overview", "payment", "payout", "notes"] as const;

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:bookings:read" });
  if ("redirect" in guard) return guard;

  const id = ctx.params?.id as string;
  const admin = getSupabaseServerClient();
  const errors: string[] = [];

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select(
      "id, listing_id, guest_id, host_id, status, check_in_time, check_out_time, price_total, currency, stripe_payment_intent_id, stripe_checkout_session_id, stripe_status, host_net_total_pence, guest_total_pence, guest_unit_price_pence, platform_fee_bps, stripe_var_bps, stripe_fixed_pence, pricing_version, needs_review, payout_status, payout_transfer_id, payout_released_at, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (bookingError || !booking) {
    if (bookingError) {
      console.error("[ops booking detail] failed to load booking", bookingError.message);
    }
    return { notFound: true };
  }

  const [notesRes, guestRes, hostRes, listingRes] = await Promise.all([
    admin
      .from("booking_notes")
      .select("id, note, created_at, staff_user_id")
      .eq("booking_id", id)
      .order("created_at", { ascending: false }),
    booking.guest_id
      ? admin
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", booking.guest_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    booking.host_id
      ? admin
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", booking.host_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    booking.listing_id
      ? admin
          .from("listings")
          .select("id, title, location")
          .eq("id", booking.listing_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
  ]);

  if (notesRes.error) {
    errors.push(`Booking notes could not be loaded: ${notesRes.error.message}`);
  }
  if (guestRes.error) {
    errors.push(`Guest profile could not be loaded: ${guestRes.error.message}`);
  }
  if (hostRes.error) {
    errors.push(`Host profile could not be loaded: ${hostRes.error.message}`);
  }
  if (listingRes.error) {
    errors.push(`Listing details could not be loaded: ${listingRes.error.message}`);
  }

  return {
    props: {
      booking: booking as BookingDetail,
      notes: (notesRes.data ?? []) as BookingNote[],
      guest: (guestRes.data ?? null) as ProfileSummary | null,
      host: (hostRes.data ?? null) as ProfileSummary | null,
      listing: (listingRes.data ?? null) as ListingSummary | null,
      staffRole: guard.staff.role,
      errors,
    },
  };
};

export default function OpsBookingDetail({
  booking,
  notes,
  guest,
  host,
  listing,
  staffRole,
  errors,
}: PageProps) {
  const router = useRouter();
  const role = staffRole as OpsRole;
  const canEditBooking = hasOpsPermission(role, "ops:bookings:write");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const queryTab = typeof router.query.tab === "string" ? router.query.tab : null;
  const activeTab = useMemo(
    () => (TABS.includes(queryTab as any) ? (queryTab as (typeof TABS)[number]) : "overview"),
    [queryTab]
  );

  const runAction = async (path: string, body?: Record<string, any>) => {
    setActionStatus("Working...");
    try {
      const resp = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : null,
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Action failed");
      setActionStatus("Done");
      window.location.reload();
    } catch (err: any) {
      setActionStatus(err?.message ?? "Action failed");
    }
  };

  const guestLabel = guest?.full_name?.trim() || guest?.email?.trim() || booking.guest_id || "Guest";
  const hostLabel = host?.full_name?.trim() || host?.email?.trim() || booking.host_id || "Host";
  const listingLabel = listing?.title?.trim() || booking.listing_id || "Listing";

  return (
    <OpsLayout title="Booking detail" role={staffRole}>
      <div className="space-y-6">
        <OpsErrorPanel messages={errors} />

        <div className="grid gap-6 lg:grid-cols-[2.4fr_1fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                    Booking
                  </p>
                  <h1 className="mt-2 text-lg font-semibold text-white">{booking.id}</h1>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <OpsStatusBadge label={booking.status ?? "unknown"} tone={statusTone(booking.status)} />
                    <OpsStatusBadge
                      label={booking.stripe_status ?? "no stripe state"}
                      tone={statusTone(booking.stripe_status)}
                    />
                    <OpsStatusBadge
                      label={booking.payout_status ?? "no payout state"}
                      tone={statusTone(booking.payout_status)}
                    />
                  </div>
                </div>
                <div className="text-xs text-[var(--ops-muted)]">
                  Created {formatDateTime(booking.created_at)}
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Guest</p>
                  <p className="mt-2 text-sm font-semibold text-white">{guestLabel}</p>
                  <p className="mt-1 break-all text-xs text-[var(--ops-muted)]">{booking.guest_id ?? "—"}</p>
                </div>
                <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Host</p>
                  <p className="mt-2 text-sm font-semibold text-white">{hostLabel}</p>
                  <p className="mt-1 break-all text-xs text-[var(--ops-muted)]">{booking.host_id ?? "—"}</p>
                </div>
                <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Listing</p>
                  <p className="mt-2 text-sm font-semibold text-white">{listingLabel}</p>
                  <p className="mt-1 text-xs text-[var(--ops-muted)]">
                    {listing?.location ?? booking.listing_id ?? "—"}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Dates</p>
                  <p className="mt-2 text-sm text-white">
                    {formatDateTime(booking.check_in_time)} → {formatDateTime(booking.check_out_time)}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Guest total</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {booking.guest_total_pence != null
                      ? formatCurrencyPence(booking.guest_total_pence, booking.currency ?? "GBP")
                      : formatCurrencyMajor(booking.price_total, booking.currency ?? "GBP")}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Host net</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {formatCurrencyPence(booking.host_net_total_pence, booking.currency ?? "GBP")}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
              <div className="flex flex-wrap gap-2 border-b border-[var(--ops-border)] pb-4">
                {TABS.map((tab) => (
                  <Link
                    key={tab}
                    href={`/ops/bookings/${booking.id}?tab=${tab}`}
                    className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${
                      activeTab === tab
                        ? "bg-slate-900 text-white"
                        : "text-[var(--ops-muted)] hover:text-slate-900"
                    }`}
                  >
                    {tab}
                  </Link>
                ))}
              </div>

              {activeTab === "overview" && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]">
                    <div className="flex justify-between gap-3">
                      <span>Booking ID</span>
                      <span className="break-all font-mono text-white">{booking.id}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Listing ID</span>
                      <span className="break-all font-mono text-white">{booking.listing_id ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Needs review</span>
                      <span className="text-white">{booking.needs_review ? "Yes" : "No"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Pricing version</span>
                      <span className="text-white">{booking.pricing_version ?? "—"}</span>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]">
                    <div className="flex justify-between gap-3">
                      <span>Guest unit price</span>
                      <span className="text-white">
                        {formatCurrencyPence(booking.guest_unit_price_pence, booking.currency ?? "GBP")}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Platform fee</span>
                      <span className="text-white">
                        {booking.platform_fee_bps != null ? `${booking.platform_fee_bps} bps` : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Stripe variable fee</span>
                      <span className="text-white">
                        {booking.stripe_var_bps != null ? `${booking.stripe_var_bps} bps` : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Stripe fixed fee</span>
                      <span className="text-white">
                        {formatCurrencyPence(booking.stripe_fixed_pence, booking.currency ?? "GBP")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "payment" && (
                <div className="mt-4 space-y-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]">
                  <div className="flex justify-between gap-3">
                    <span>Stripe status</span>
                    <span className="text-white">{booking.stripe_status ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Payment intent ID</span>
                    <span className="break-all font-mono text-white">{booking.stripe_payment_intent_id ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Checkout session ID</span>
                    <span className="break-all font-mono text-white">{booking.stripe_checkout_session_id ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Guest total</span>
                    <span className="text-white">
                      {booking.guest_total_pence != null
                        ? formatCurrencyPence(booking.guest_total_pence, booking.currency ?? "GBP")
                        : formatCurrencyMajor(booking.price_total, booking.currency ?? "GBP")}
                    </span>
                  </div>
                </div>
              )}

              {activeTab === "payout" && (
                <div className="mt-4 space-y-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]">
                  <div className="flex justify-between gap-3">
                    <span>Payout status</span>
                    <span className="text-white">{booking.payout_status ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Host net</span>
                    <span className="text-white">
                      {formatCurrencyPence(booking.host_net_total_pence, booking.currency ?? "GBP")}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Transfer ID</span>
                    <span className="break-all font-mono text-white">{booking.payout_transfer_id ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Released at</span>
                    <span className="text-white">{formatDateTime(booking.payout_released_at)}</span>
                  </div>
                </div>
              )}

              {activeTab === "notes" && (
                <div className="mt-4 space-y-4">
                  <div className="space-y-3">
                    {notes.length === 0 ? (
                      <p className="text-sm text-[var(--ops-muted)]">No internal notes yet.</p>
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]"
                        >
                          <p className="text-white">{note.note}</p>
                          <div className="mt-2 text-xs text-[var(--ops-muted)]">
                            {note.staff_user_id} · {formatDateTime(note.created_at)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                    <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                      Add note
                    </label>
                    <textarea
                      value={noteText}
                      onChange={(event) => setNoteText(event.target.value)}
                      className="mt-2 min-h-[120px] w-full rounded-xl border border-[var(--ops-border)] bg-white p-3 text-sm text-slate-900"
                    />
                    <button
                      onClick={() => runAction(`/api/ops/bookings/${booking.id}/note`, { note: noteText })}
                      className="mt-3 rounded-xl border border-[var(--ops-border)] bg-slate-900 px-4 py-2 text-sm font-semibold !text-white hover:bg-slate-800"
                    >
                      Save note
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Actions</p>
              <div className="mt-4 space-y-3">
                {canEditBooking && (
                  <>
                    <button
                      onClick={() =>
                        runAction(`/api/ops/bookings/${booking.id}/review`, { needsReview: true })
                      }
                      className="w-full rounded-xl border border-[var(--ops-border)] bg-slate-900 px-4 py-2 text-sm font-semibold !text-white hover:bg-slate-800"
                    >
                      Mark needs review
                    </button>
                    <button
                      onClick={() =>
                        runAction(`/api/ops/bookings/${booking.id}/review`, { needsReview: false })
                      }
                      className="w-full rounded-xl border border-[var(--ops-border)] bg-slate-900 px-4 py-2 text-sm font-semibold !text-white hover:bg-slate-800"
                    >
                      Clear review flag
                    </button>
                    <button
                      onClick={() => runAction(`/api/ops/bookings/${booking.id}/cancel`)}
                      className="w-full rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
                    >
                      Cancel booking
                    </button>
                  </>
                )}
                {!canEditBooking && (
                  <p className="text-xs text-[var(--ops-muted)]">No actions available.</p>
                )}
              </div>
              {actionStatus && <p className="mt-3 text-xs text-[var(--ops-muted)]">{actionStatus}</p>}
            </div>

            <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Case management</p>
              <p className="mt-4 text-sm text-[var(--ops-muted)]">
                Case management is not yet available in this environment.
              </p>
            </div>

            <div className="rounded-3xl border border-amber-300/60 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="text-xs uppercase tracking-[0.3em] text-amber-700">Manual refund reminder</p>
              <p className="mt-3 font-semibold">Refunds are still a Stripe-first manual process.</p>
              <ul className="mt-3 space-y-2 text-amber-800">
                <li>Use the Payment Intent ID to find the payment in Stripe.</li>
                <li>Issue the refund in Stripe before changing internal booking notes.</li>
                <li>Record refund amount, refund ID, and reason in internal notes or a linked case.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
