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
    bgClass: "bg-[#FEDD02]",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/direct.svg",
  },
  airbnb: {
    label: "Airbnb",
    bgClass: "bg-[#FF385C]",
    textClass: "text-white",
    badgeIcon: "/channel-icons/airbnb.svg",
  },
  vrbo: {
    label: "Vrbo",
    bgClass: "bg-[#2563EB]",
    textClass: "text-white",
    badgeIcon: "/channel-icons/vrbo.svg",
  },
  bookingcom: {
    label: "Booking.com",
    bgClass: "bg-[#1D4ED8]",
    textClass: "text-white",
    badgeIcon: "/channel-icons/booking.svg",
  },
  expedia: {
    label: "Expedia",
    bgClass: "bg-[#FCD34D]",
    textClass: "text-slate-900",
    badgeIcon: "/channel-icons/expedia.svg",
  },
  manual: {
    label: "Manual",
    bgClass: "bg-slate-200",
    textClass: "text-slate-700",
    badgeIcon: "/channel-icons/manual.svg",
  },
  other: {
    label: "External",
    bgClass: "bg-slate-200",
    textClass: "text-slate-700",
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
        textClass: "text-slate-700",
        badgeIcon: "/channel-icons/manual.svg",
      };
    }
    return {
      label: "External block",
      bgClass: "bg-slate-100",
      textClass: "text-slate-600",
      badgeIcon: "/channel-icons/other.svg",
    };
  }

  return CHANNEL_META[normalized] ?? CHANNEL_META.booking;
}
