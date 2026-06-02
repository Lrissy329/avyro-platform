export const FLEX_CUTOFF_HOUR_UTC = 14;
export const ROLLING_FLEX_DAYS_BEFORE_CUTOFF = 2;
export const ROLLING_FLEX_CUTOFF_HOUR = 18;

export const isMissingColumnError = (error: any) => {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("schema cache") ||
    (message.includes("column") && message.includes("does not exist"))
  );
};

export const parseIso = (value?: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
};

export const addDaysUtc = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const toUtcDateOnly = (value?: string | null): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
};

export const toUtcDateOnlyString = (date: Date): string => date.toISOString().slice(0, 10);

export const diffNightsUtc = (startDate: Date, endDate: Date) =>
  Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));

export const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const getFlexCutoffAt = (
  checkOutTime?: string | null,
  explicitCutoffAt?: string | null
): Date | null => {
  const explicit = parseIso(explicitCutoffAt);
  if (explicit) return explicit;

  const checkout = parseIso(checkOutTime);
  if (!checkout) return null;

  const cutoff = new Date(checkout);
  cutoff.setUTCHours(FLEX_CUTOFF_HOUR_UTC, 0, 0, 0);
  return cutoff;
};

type ComputeRollingFlexCutoffInput = {
  confirmedEndDate: string | Date;
  daysBefore?: number;
  cutoffHour?: number;
  timezone?: string;
};

// MVP: compute with UTC day boundaries. The timezone parameter is accepted for API
// compatibility and future locale-aware calculations.
export const computeRollingFlexCutoff = ({
  confirmedEndDate,
  daysBefore = ROLLING_FLEX_DAYS_BEFORE_CUTOFF,
  cutoffHour = ROLLING_FLEX_CUTOFF_HOUR,
  timezone: _timezone,
}: ComputeRollingFlexCutoffInput): Date | null => {
  const parsed =
    confirmedEndDate instanceof Date
      ? new Date(confirmedEndDate)
      : toUtcDateOnly(String(confirmedEndDate));
  if (!parsed || !Number.isFinite(parsed.getTime())) return null;

  const cutoffBase = addDaysUtc(parsed, -Math.max(0, Math.round(daysBefore)));
  cutoffBase.setUTCHours(clampNumber(Math.round(cutoffHour), 0, 23), 0, 0, 0);
  return cutoffBase;
};

export const isSameUtcDay = (a: Date, b: Date) =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();
