import type { LucideIcon } from "lucide-react";
import {
  BriefcaseBusiness,
  Clock3,
  MailCheck,
  MapPin,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type TrustBadgeType =
  | "profile_complete"
  | "email_verified"
  | "professional"
  | "airport_local"
  | "responsive_host"
  | "flexivo_host";

type TrustBadgeConfig = {
  label: string;
  icon: LucideIcon;
  styles: string;
  iconStyles: string;
};

type TrustBadgeProps = {
  type: TrustBadgeType;
  label?: string;
  className?: string;
};

const BADGE_CONFIG: Record<TrustBadgeType, TrustBadgeConfig> = {
  profile_complete: {
    label: "Profile complete",
    icon: UserCheck,
    styles: "border-emerald-200 bg-emerald-50 text-emerald-700",
    iconStyles: "text-emerald-600",
  },
  email_verified: {
    label: "Email verified",
    icon: MailCheck,
    styles: "border-emerald-200 bg-emerald-50 text-emerald-700",
    iconStyles: "text-emerald-600",
  },
  professional: {
    label: "Professional profile",
    icon: BriefcaseBusiness,
    styles: "border-slate-200 bg-slate-50 text-slate-700",
    iconStyles: "text-slate-500",
  },
  airport_local: {
    label: "Near airport",
    icon: MapPin,
    styles: "border-slate-200 bg-white text-slate-700",
    iconStyles: "text-slate-500",
  },
  responsive_host: {
    label: "Responds quickly",
    icon: Clock3,
    styles: "border-emerald-200 bg-emerald-50 text-emerald-700",
    iconStyles: "text-emerald-600",
  },
  flexivo_host: {
    label: "Hosted on Flexivo",
    icon: ShieldCheck,
    styles: "border-[#FEDD02]/70 bg-[#FFF8CC] text-slate-800",
    iconStyles: "text-amber-600",
  },
};

export default function TrustBadge({ type, label, className }: TrustBadgeProps) {
  const config = BADGE_CONFIG[type];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        config.styles,
        className
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", config.iconStyles)} aria-hidden="true" />
      <span>{label ?? config.label}</span>
    </span>
  );
}
