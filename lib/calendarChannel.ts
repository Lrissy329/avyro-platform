import type { LinearCalendarSource } from "@/lib/calendarTypes";

type ChannelMeta = {
  label: string;
  bgClass: string;
  textClass: string;
  badgeIcon: string;
};

type ChannelMetaOptions = {
  isBlock?: boolean;
};

const CHANNEL_META: Record<LinearCalendarSource, ChannelMeta> = {
  booking: {
    label: "Direct",
    bgClass: "bg-yellow-200",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/direct.svg",
  },
  airbnb: {
    label: "Airbnb",
    bgClass: "bg-emerald-200",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/airbnb.svg",
  },
  vrbo: {
    label: "Vrbo",
    bgClass: "bg-blue-200",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/vrbo.svg",
  },
  bookingcom: {
    label: "Booking.com",
    bgClass: "bg-blue-200",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/booking.svg",
  },
  expedia: {
    label: "Expedia",
    bgClass: "bg-blue-200",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/expedia.svg",
  },
  manual: {
    label: "Manual",
    bgClass: "bg-slate-300",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/manual.svg",
  },
  other: {
    label: "External",
    bgClass: "bg-slate-200",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/other.svg",
  },
};

export function getChannelMeta(
  source: LinearCalendarSource,
  options?: ChannelMetaOptions
): ChannelMeta {
  const normalized = source ?? "booking";
  if (options?.isBlock) {
    if (normalized === "manual") {
      return {
        label: "Manual block",
        bgClass: "bg-slate-200",
        textClass: "text-slate-900",
        badgeIcon: "/channel-icons/manual.svg",
      };
    }
    return {
      label: "External block",
      bgClass: "bg-slate-200",
      textClass: "text-slate-900",
      badgeIcon: "/channel-icons/other.svg",
    };
  }

  return CHANNEL_META[normalized] ?? CHANNEL_META.booking;
}
