import { addDays, addMonths, startOfDay, startOfMonth } from "@/lib/dateUtils";
import type { HostCalendarView } from "@/modules/calendar/types";

export type CalendarVisibleRange = {
  start: Date;
  end: Date;
};

export function getSchedulerRange(anchorDate: Date): CalendarVisibleRange {
  const start = startOfDay(anchorDate);
  const end = addDays(start, 13);
  return { start, end };
}

export function getHourlyRange(anchorDate: Date): CalendarVisibleRange {
  const start = startOfDay(anchorDate);
  const end = addDays(start, 1);
  return { start, end };
}

export function getMonthRange(anchorDate: Date): CalendarVisibleRange {
  const start = startOfMonth(anchorDate);
  const end = addDays(startOfMonth(addMonths(start, 1)), -1);
  return { start, end };
}

export function getVisibleRangeForView(
  view: HostCalendarView,
  schedulerAnchor: Date,
  hourlyAnchor: Date,
  monthAnchor: Date
): CalendarVisibleRange {
  if (view === "hourly") return getHourlyRange(hourlyAnchor);
  if (view === "month") return getMonthRange(monthAnchor);
  return getSchedulerRange(schedulerAnchor);
}

export function navigateAnchor(view: HostCalendarView, current: Date, direction: -1 | 1): Date {
  if (view === "hourly") return addDays(current, direction);
  if (view === "month") return startOfMonth(addMonths(current, direction));
  return addDays(current, direction * 14);
}

export function todayAnchorForView(view: HostCalendarView): Date {
  if (view === "month") return startOfMonth(new Date());
  return startOfDay(new Date());
}
