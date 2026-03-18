import { useCallback, useEffect, useState } from "react";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HostPageHeader } from "@/components/host/HostPageHeader";
import { supabase } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/ensureProfile";

type PayoutRow = {
  id: string;
  status: string | null;
  payout_status?: string | null;
  payout_released_at?: string | null;
  payout_transfer_id?: string | null;
  host_net_total_pence?: number | null;
  currency?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  check_in?: string | null;
  check_out?: string | null;
};

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const statusStyles: Record<string, string> = {
  scheduled: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  pending: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function HostPayoutsPage() {
  const [loading, setLoading] = useState(true);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stripeStatus, setStripeStatus] = useState<{
    accountId: string | null;
    onboardingStatus: string | null;
    email: string | null;
  }>({ accountId: null, onboardingStatus: null, email: null });
  const [connecting, setConnecting] = useState(false);

  const loadPayouts = useCallback(async () => {
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

    await ensureProfile();

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_onboarding_status")
      .eq("id", user.id)
      .maybeSingle();

    setStripeStatus({
      accountId: (profileRow as any)?.stripe_account_id ?? null,
      onboardingStatus: (profileRow as any)?.stripe_onboarding_status ?? null,
      email: user.email ?? null,
    });

    const payoutSelects = [
      "id, status, payout_status, payout_released_at, payout_transfer_id, host_net_total_pence, currency, check_in_time, check_out_time",
      "id, status, payout_status, payout_released_at, payout_transfer_id, host_net_total_pence, currency, check_in, check_out",
      "id, status, host_net_total_pence, currency, check_in_time, check_out_time",
    ];

    let payoutRows: PayoutRow[] = [];
    let payoutError: any = null;

    for (const select of payoutSelects) {
      const { data, error } = await supabase
        .from("bookings")
        .select(select)
        .eq("host_id", user.id)
        .order("check_in_time", { ascending: false })
        .order("check_in", { ascending: false })
        .limit(200);

      payoutRows = (data as unknown as PayoutRow[]) ?? [];
      payoutError = error;

      if (!payoutError) break;
      if (!isMissingColumn(payoutError)) break;
    }

    if (payoutError) {
      setError(payoutError.message ?? "Unable to load payouts.");
      setPayouts([]);
      setLoading(false);
      return;
    }

    setPayouts(payoutRows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPayouts();
  }, [loadPayouts]);

  const handleConnectStripe = useCallback(async () => {
    if (!stripeStatus.accountId && !stripeStatus.email) return;
    setConnecting(true);
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
      alert(err?.message ?? "Unable to connect Stripe.");
    } finally {
      setConnecting(false);
    }
  }, [stripeStatus.accountId, stripeStatus.email]);

  const isStripeConnected = stripeStatus.onboardingStatus === "complete";
  const stripeLabel = isStripeConnected
    ? "Connected"
    : stripeStatus.accountId
      ? "Setup incomplete"
      : "Not connected";
  const stripeBadgeClass = isStripeConnected
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : stripeStatus.accountId
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-slate-50 text-slate-500 border-slate-200";

  return (
    <HostShellLayout title="Payouts" activeNav="payouts">
      <div className="space-y-8">
        <HostPageHeader
          title="Payouts"
          description="Track upcoming transfers and keep your Stripe payout details up to date."
          actions={
            <div className="flex items-center gap-3">
              <Badge className={`rounded-full border px-3 py-1 text-xs font-semibold ${stripeBadgeClass}`}>
                {stripeLabel}
              </Badge>
              <Button
                size="sm"
                onClick={handleConnectStripe}
                disabled={connecting}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
              >
                {stripeStatus.accountId ? "Update payout details" : "Connect Stripe"}
              </Button>
            </div>
          }
        />

        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Stripe Connect</p>
              <p className="mt-1 text-sm text-slate-600">
                {stripeStatus.accountId
                  ? "Payouts are sent to your connected Stripe Express account."
                  : "Connect Stripe to receive payouts and manage tax details."}
              </p>
            </div>
            <Button
              onClick={handleConnectStripe}
              disabled={connecting}
              className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
            >
              {stripeStatus.accountId ? "Continue onboarding" : "Connect Stripe"}
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] gap-4 border-b border-slate-200 bg-slate-50 px-6 py-3 text-xs uppercase tracking-wider text-slate-500">
            <span>Booking</span>
            <span>Status</span>
            <span>Payout</span>
            <span>Amount</span>
            <span>Release</span>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-sm text-slate-500">Loading payouts…</div>
          ) : error ? (
            <div className="px-6 py-8 text-sm text-rose-600">{error}</div>
          ) : payouts.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-500">No payout activity yet.</div>
          ) : (
            <div>
              {payouts.map((row) => {
                const payoutStatus = row.payout_status ?? (row.status ?? "pending");
                const statusKey = String(payoutStatus || "pending").toLowerCase();
                const statusClass =
                  statusStyles[statusKey] ?? "bg-slate-50 text-slate-600 border-slate-200";
                const amount =
                  row.host_net_total_pence != null
                    ? `${row.currency ?? "GBP"} ${(row.host_net_total_pence / 100).toFixed(0)}`
                    : "—";
                const releaseDate = formatDate(row.payout_released_at);
                const stayStart = row.check_in_time ?? row.check_in ?? null;
                const stayEnd = row.check_out_time ?? row.check_out ?? null;
                const stayLabel =
                  stayStart && stayEnd
                    ? `${formatDate(stayStart)} → ${formatDate(stayEnd)}`
                    : row.id;

                return (
                  <div
                    key={row.id}
                    className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] gap-4 border-b border-slate-100 px-6 py-3 text-sm hover:bg-slate-50"
                  >
                    <div className="text-sm font-semibold text-slate-900">{stayLabel}</div>
                    <div>
                      <Badge className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
                        {statusKey.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-500">{row.payout_transfer_id ?? "—"}</div>
                    <div className="text-sm font-semibold text-slate-900">{amount}</div>
                    <div className="text-xs text-slate-500">{releaseDate}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </HostShellLayout>
  );
}
