import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { hasOpsPermission, type OpsRole } from "@/lib/opsRbac";

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
  created_at?: string | null;
};

type BookingNote = {
  id: string;
  note: string;
  created_at: string;
  staff_user_id: string;
};

type PageProps = {
  booking: BookingDetail;
  notes: BookingNote[];
  staffRole: OpsRole;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const TABS = ["overview", "payment", "payout", "notes"] as const;

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:bookings:read" });
  if ("redirect" in guard) return guard;

  const id = ctx.params?.id as string;
  const admin = getSupabaseServerClient();

  const { data: booking } = await admin
    .from("bookings")
    .select(
      "id, listing_id, guest_id, host_id, status, check_in_time, check_out_time, price_total, currency, stripe_payment_intent_id, stripe_status, host_net_total_pence, guest_total_pence, guest_unit_price_pence, platform_fee_bps, stripe_var_bps, stripe_fixed_pence, pricing_version, needs_review, payout_status, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) {
    return {
      notFound: true,
    };
  }

  const { data: notes } = await admin
    .from("booking_notes")
    .select("id, note, created_at, staff_user_id")
    .eq("booking_id", id)
    .order("created_at", { ascending: false });

  return {
    props: {
      booking: booking as BookingDetail,
      notes: (notes ?? []) as BookingNote[],
      staffRole: guard.staff.role,
    },
  };
};

export default function OpsBookingDetail({ booking, notes, staffRole }: PageProps) {
  const router = useRouter();
  const role = staffRole as OpsRole;
  const canEditBooking = hasOpsPermission(role, "ops:bookings:write");
  const canCreateCase = hasOpsPermission(role, "ops:cases:write");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const queryTab = typeof router.query.tab === "string" ? router.query.tab : null;
  const activeTab = useMemo(
    () => (TABS.includes(queryTab as any) ? (queryTab as typeof TABS[number]) : "overview"),
    [queryTab]
  );

  const runAction = async (path: string, body?: Record<string, any>) => {
    setActionStatus("working");
    try {
      const resp = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : null,
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Action failed");
      setActionStatus("done");
      window.location.reload();
    } catch (err: any) {
      setActionStatus(err?.message ?? "Action failed");
    }
  };

  const createCase = async () => {
    setActionStatus("working");
    try {
      const resp = await fetch(`/api/ops/cases/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Failed to create case");
      if (payload?.caseId) {
        window.location.href = `/ops/cases/${payload.caseId}`;
        return;
      }
      window.location.reload();
    } catch (err: any) {
      setActionStatus(err?.message ?? "Failed to create case");
    }
  };

  return (
    <OpsLayout title="Booking detail" role={staffRole}>
      <div className="grid gap-6 lg:grid-cols-[2.4fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Booking
                </p>
                <h1 className="mt-2 text-lg font-semibold text-white">{booking.id}</h1>
              </div>
              <div className="text-xs text-[var(--ops-muted)]">
                Created {formatDateTime(booking.created_at)}
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Dates</p>
                <p className="mt-2 text-sm text-white">
                  {formatDateTime(booking.check_in_time)} → {formatDateTime(booking.check_out_time)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Status</p>
                <p className="mt-2 text-sm text-white">{booking.status ?? "unknown"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Guest</p>
                <p className="mt-2 text-sm text-white">{booking.guest_id ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">Host</p>
                <p className="mt-2 text-sm text-white">{booking.host_id ?? "—"}</p>
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
                      ? "bg-slate-900 hover:bg-slate-800 !text-white"
                      : "text-[var(--ops-muted)] hover:text-slate-900"
                  }`}
                >
                  {tab}
                </Link>
              ))}
            </div>

            {activeTab === "overview" && (
              <div className="mt-4 space-y-3 text-sm text-[var(--ops-muted)]">
                <div className="flex justify-between">
                  <span>Listing</span>
                  <span className="text-white">{booking.listing_id ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="text-white">
                    {booking.price_total != null
                      ? `${booking.currency ?? "GBP"} ${booking.price_total}`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Needs review</span>
                  <span className="text-white">{booking.needs_review ? "Yes" : "No"}</span>
                </div>
              </div>
            )}

            {activeTab === "payment" && (
              <div className="mt-4 space-y-3 text-sm text-[var(--ops-muted)]">
                <div className="flex justify-between">
                  <span>Payment intent</span>
                  <span className="text-white">{booking.stripe_payment_intent_id ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Stripe status</span>
                  <span className="text-white">{booking.stripe_status ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Guest total (pence)</span>
                  <span className="text-white">{booking.guest_total_pence ?? "—"}</span>
                </div>
              </div>
            )}

            {activeTab === "payout" && (
              <div className="mt-4 space-y-3 text-sm text-[var(--ops-muted)]">
                <div className="flex justify-between">
                  <span>Host net (pence)</span>
                  <span className="text-white">{booking.host_net_total_pence ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payout status</span>
                  <span className="text-white">{booking.payout_status ?? "—"}</span>
                </div>
              </div>
            )}

            {activeTab === "notes" && (
              <div className="mt-4 space-y-4">
                <div className="space-y-3">
                  {notes.length === 0 ? (
                    <p className="text-sm text-[var(--ops-muted)]">No notes yet.</p>
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
                    className="mt-3 rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
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
              {canCreateCase && (
                <button
                  onClick={createCase}
                  className="w-full rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
                >
                  Create case from booking
                </button>
              )}
              {canEditBooking && (
                <>
                  <button
                    onClick={() =>
                      runAction(`/api/ops/bookings/${booking.id}/review`, { needsReview: true })
                    }
                    className="w-full rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
                  >
                    Mark needs review
                  </button>
                  <button
                    onClick={() =>
                      runAction(`/api/ops/bookings/${booking.id}/review`, { needsReview: false })
                    }
                    className="w-full rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
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
              {!canCreateCase && !canEditBooking && (
                <p className="text-xs text-[var(--ops-muted)]">No actions available.</p>
              )}
            </div>
            {actionStatus && (
              <p className="mt-3 text-xs text-[var(--ops-muted)]">{actionStatus}</p>
            )}
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
