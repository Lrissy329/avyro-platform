import { getTimeZoneParts } from "@/lib/dateUtils";

// Shared deterministic date/time formatting for the ops console.
//
// Two distinct sources of SSR/hydration mismatch exist when relying on
// Intl.DateTimeFormat#format() / Date#toLocaleString() / Date#toLocaleDateString():
//
// 1. Combining date and time fields in one call goes through a CLDR "glue"
//    pattern (e.g. ", " vs " at ") that varies by ICU data version -- SSR
//    (Node) and hydration (browser) can disagree even with identical field
//    values.
// 2. Locale-dependent NAME text itself (e.g. September's short form: "Sep"
//    vs "Sept") has changed between CLDR versions -- this is a different
//    failure mode that persists even after switching to formatToParts(),
//    since formatToParts() still returns whatever name string the running
//    ICU version resolves.
//
// This module avoids both: getTimeZoneParts() (lib/dateUtils.ts) extracts
// only NUMERIC field values via formatToParts(), which are ICU-version
// stable, and month names are resolved from a hardcoded table instead of
// asking Intl for them. Every string returned here is built from literals
// this codebase controls.

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const DEFAULT_OPS_TIME_ZONE = "Europe/London";

const pad2 = (value: number) => String(value).padStart(2, "0");

export const parseOpsDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const getOpsDateTimeParts = (date: Date, timeZone: string) => {
  const parts = getTimeZoneParts(date, timeZone);
  const monthIndex = Math.min(11, Math.max(0, parts.month - 1));
  return {
    day: pad2(parts.day),
    month: SHORT_MONTHS[monthIndex],
    year: String(parts.year),
    hour: pad2(parts.hour),
    minute: pad2(parts.minute),
  };
};

/** "22 Sep" */
export const formatOpsShortDate = (
  value?: string | null,
  timeZone: string = DEFAULT_OPS_TIME_ZONE
): string => {
  const date = parseOpsDate(value);
  if (!date) return "—";
  const { day, month } = getOpsDateTimeParts(date, timeZone);
  return `${day} ${month}`;
};

/** "22 Sep 2026" */
export const formatOpsDate = (
  value?: string | null,
  timeZone: string = DEFAULT_OPS_TIME_ZONE
): string => {
  const date = parseOpsDate(value);
  if (!date) return "—";
  const { day, month, year } = getOpsDateTimeParts(date, timeZone);
  return `${day} ${month} ${year}`;
};

/** "22 Sep 15:03" */
export const formatOpsShortDateTime = (
  value?: string | null,
  timeZone: string = DEFAULT_OPS_TIME_ZONE
): string => {
  const date = parseOpsDate(value);
  if (!date) return "—";
  const { day, month, hour, minute } = getOpsDateTimeParts(date, timeZone);
  return `${day} ${month} ${hour}:${minute}`;
};

/** "22 Sep 2026, 15:03" */
export const formatOpsDateTime = (
  value?: string | null,
  timeZone: string = DEFAULT_OPS_TIME_ZONE
): string => {
  const date = parseOpsDate(value);
  if (!date) return "—";
  const { day, month, year, hour, minute } = getOpsDateTimeParts(date, timeZone);
  return `${day} ${month} ${year}, ${hour}:${minute}`;
};
