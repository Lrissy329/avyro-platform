type RollingFlexCardProps = {
  enabled: boolean;
  status: string | null | undefined;
  confirmedEnd?: string | null;
  maxEnd?: string | null;
  cutoffAt?: string | null;
  rollingWindowDays?: number | null;
  busy?: boolean;
  error?: string | null;
  onExtend?: () => void;
  onRelease?: () => void;
};

const parseDateOnly = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
};

const addDaysUtc = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const formatDate = (value?: string | null) => {
  const parsed = parseDateOnly(value);
  if (!parsed) return "—";
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function RollingFlexCard({
  enabled,
  status,
  confirmedEnd,
  maxEnd,
  cutoffAt,
  rollingWindowDays,
  busy = false,
  error = null,
  onExtend,
  onRelease,
}: RollingFlexCardProps) {
  if (!enabled) return null;

  const normalizedStatus = String(status ?? "inactive").toLowerCase();
  const confirmedEndDate = parseDateOnly(confirmedEnd);
  const maxEndDate = parseDateOnly(maxEnd);
  const windowDays = Math.max(1, Math.round(Number(rollingWindowDays ?? 1)) || 1);
  const cutoffDate = cutoffAt ? new Date(cutoffAt) : null;
  const now = new Date();

  const nextWindowStart = confirmedEndDate ? toDateOnly(confirmedEndDate) : null;
  const nextWindowEnd = (() => {
    if (!confirmedEndDate || !maxEndDate) return null;
    const next = addDaysUtc(confirmedEndDate, windowDays);
    const clamped = next.getTime() <= maxEndDate.getTime() ? next : maxEndDate;
    if (clamped.getTime() <= confirmedEndDate.getTime()) return null;
    return toDateOnly(clamped);
  })();

  if (normalizedStatus === "ended") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-800">Your stay has been extended</p>
        <p className="mt-1 text-xs text-emerald-700">
          Confirmed through {formatDate(confirmedEnd)}. The rolling flex window has now ended.
        </p>
      </div>
    );
  }

  if (normalizedStatus === "released" || normalizedStatus === "expired") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Flexible continuation is no longer reserved</p>
        <p className="mt-1 text-xs text-slate-600">
          If you still need more nights, check availability and book again.
        </p>
      </div>
    );
  }

  const decisionWindowOpen =
    normalizedStatus === "active" &&
    Boolean(cutoffDate && Number.isFinite(cutoffDate.getTime()) && now.getTime() <= cutoffDate.getTime());

  const inDecisionState =
    decisionWindowOpen &&
    Boolean(cutoffDate && now.getTime() >= cutoffDate.getTime() - 72 * 60 * 60 * 1000);

  if (inDecisionState) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Do you want to stay longer?</p>
        <p className="mt-1 text-xs text-amber-800">
          Current stay ends {formatDate(confirmedEnd)}. Reserved next window:{" "}
          {nextWindowStart && nextWindowEnd ? `${formatDate(nextWindowStart)} → ${formatDate(nextWindowEnd)}` : "—"}.
        </p>
        <p className="mt-1 text-xs text-amber-800">Decision by {formatDateTime(cutoffAt)}.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onExtend}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? "Processing…" : "Extend stay"}
          </button>
          <button
            type="button"
            onClick={onRelease}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Leave as planned
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">Flexible stay active</p>
      <p className="mt-1 text-xs text-slate-600">
        Your stay is confirmed until {formatDate(confirmedEnd)} and can extend up to {formatDate(maxEnd)}.
      </p>
      {nextWindowStart && nextWindowEnd ? (
        <p className="mt-1 text-xs text-slate-600">
          Reserved next window: {formatDate(nextWindowStart)} → {formatDate(nextWindowEnd)}.
        </p>
      ) : null}
      <p className="mt-1 text-xs text-slate-600">Next decision by {formatDateTime(cutoffAt)}.</p>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

