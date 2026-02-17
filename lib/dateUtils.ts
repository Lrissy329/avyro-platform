export const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

// Local YYYY-MM-DD (avoids UTC/DST shifts when rendering calendar days)
export const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getTimeZoneParts = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
};

const getTimeZoneOffset = (timeZone: string, date: Date) => {
  const parts = getTimeZoneParts(date, timeZone);
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUTC - date.getTime();
};

// Convert a calendar day into the UTC instant for midnight in the given time zone.
export const startOfDayInTimeZone = (date: Date, timeZone: string): Date => {
  const parts = getTimeZoneParts(date, timeZone);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  const offset = getTimeZoneOffset(timeZone, utcDate);
  return new Date(utcDate.getTime() - offset);
};

export const addDays = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

export const addMonths = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
};

export const startOfWeek = (date: Date): Date => {
  const next = startOfDay(date);
  const day = next.getDay(); // 0 Sunday
  const diff = (day + 6) % 7; // Monday as start
  next.setDate(next.getDate() - diff);
  return next;
};

export const startOfMonth = (date: Date): Date => {
  const next = startOfDay(date);
  next.setDate(1);
  return next;
};

export const daysInMonth = (date: Date): number => {
  const year = date.getFullYear();
  const month = date.getMonth();
  return new Date(year, month + 1, 0).getDate();
};

export const diffInDays = (target: Date, base: Date): number => {
  const ms = startOfDay(target).getTime() - startOfDay(base).getTime();
  return Math.floor(ms / 86400000);
};

export const formatISODate = (date: Date): string => date.toISOString().slice(0, 10);

export const rangeToDates = (start: Date, end: Date): Date[] => {
  const dates: Date[] = [];
  let cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
};

export const formatCurrency = (value?: number | null, currency?: string | null): string | null => {
  if (value === undefined || value === null) return null;
  try {
    const isWhole = Math.round(value * 100) % 100 === 0;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "GBP",
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: isWhole ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency ?? "GBP"} ${value}`;
  }
};

export const formatRangeSummary = (start: Date, end: Date): string => {
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};
