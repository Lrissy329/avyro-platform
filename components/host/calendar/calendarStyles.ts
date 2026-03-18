export const DAY_COL_WIDTH = 96;
export const ROW_HEIGHT = 68;
export const BAR_HEIGHT = 32;
export const LEFT_LABEL_WIDTH = 220;
export const LEFT_RAIL_WIDTH = 280;
export const DRAWER_WIDTH = 380;
export const HEADER_HEIGHT = 44;

export type CalendarChannel =
  | "direct"
  | "airbnb"
  | "vrbo"
  | "booking"
  | "expedia"
  | "manual"
  | "other";

export type ReservationStatus = "confirmed" | "paid" | "awaiting_payment" | "cancelled";

type ReservationTheme = {
  bgClass: string;
  textClass: string;
  badgeBgClass: string;
  faded?: boolean;
};

export function getReservationTheme(
  channel: CalendarChannel,
  status: ReservationStatus
): ReservationTheme {
  if (status === "cancelled") {
    return {
      bgClass: "bg-slate-300",
      textClass: "text-slate-600",
      badgeBgClass: "bg-white/90",
      faded: true,
    };
  }

  const base = (() => {
    switch (channel) {
      case "direct":
        return { bg: "bg-slate-900", text: "text-white" };
      case "airbnb":
        return { bg: "bg-emerald-500", text: "text-white" };
      case "booking":
        return { bg: "bg-blue-500", text: "text-white" };
      case "vrbo":
        return { bg: "bg-blue-500", text: "text-white" };
      case "expedia":
        return { bg: "bg-teal-500", text: "text-white" };
      case "manual":
        return { bg: "bg-slate-300", text: "text-slate-800" };
      case "other":
      default:
        return { bg: "bg-slate-200", text: "text-slate-800" };
    }
  })();

  const awaiting = status === "awaiting_payment";

  return {
    bgClass: awaiting ? `${base.bg} opacity-80` : base.bg,
    textClass: base.text,
    badgeBgClass: "bg-white/90",
  };
}
