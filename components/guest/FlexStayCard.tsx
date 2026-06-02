type FlexStayCardProps = {
  enabled: boolean;
  status: string | null | undefined;
  cutoffAt?: string | null;
  checkoutAt?: string | null;
  pricePence?: number | null;
  busy?: boolean;
  error?: string | null;
  onConfirm?: () => void;
  onDecline?: () => void;
};

const formatMoney = (amountMajor: number, currency = "GBP") =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMajor);

const formatCutoff = (value?: string | null) => {
  if (!value) return "14:00 on checkout day";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "14:00 on checkout day";
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const isCheckoutDay = (checkoutAt?: string | null) => {
  if (!checkoutAt) return false;
  const parsed = new Date(checkoutAt);
  if (!Number.isFinite(parsed.getTime())) return false;
  const now = new Date();
  return (
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate()
  );
};

export function FlexStayCard({
  enabled,
  status,
  cutoffAt,
  checkoutAt,
  pricePence,
  busy = false,
  error = null,
  onConfirm,
  onDecline,
}: FlexStayCardProps) {
  if (!enabled) return null;

  const normalizedStatus = String(status ?? "reserved").toLowerCase();
  const checkoutDay = isCheckoutDay(checkoutAt);
  const cutoffLabel = formatCutoff(cutoffAt);
  const flexPrice = pricePence != null && Number.isFinite(Number(pricePence)) ? Number(pricePence) / 100 : null;

  if (normalizedStatus === "used") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-800">Extra night confirmed</p>
        <p className="mt-1 text-xs text-emerald-700">
          Your booking has been extended by one night.
        </p>
      </div>
    );
  }

  if (normalizedStatus === "released" || normalizedStatus === "expired") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Extra night no longer available</p>
        <p className="mt-1 text-xs text-slate-600">
          The optional hold has been released.
        </p>
      </div>
    );
  }

  if (checkoutDay && normalizedStatus === "reserved") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Your optional extra night is ready</p>
        <p className="mt-1 text-xs text-amber-800">
          Confirm before {cutoffLabel} to extend your stay.
          {flexPrice != null ? ` Charge: ${formatMoney(flexPrice)}.` : ""}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? "Processing…" : "Confirm extra night"}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Decline
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">Optional extra night reserved</p>
      <p className="mt-1 text-xs text-slate-600">
        No charge has been taken. Decision cutoff: {cutoffLabel}.
      </p>
    </div>
  );
}
