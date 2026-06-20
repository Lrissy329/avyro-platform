import type { ReactNode } from "react";

import TrustBadge from "@/components/trust/TrustBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export type GuestProfilePreview = {
  full_name?: string | null;
  avatar_url?: string | null;
  headline?: string | null;
  bio?: string | null;
};

type BadgeTone = "default" | "verified" | "pending" | "rejected";

type Props = {
  profile: GuestProfilePreview | null;
  compact?: boolean;
  emailVerified?: boolean;
  showProfessionalPlaceholder?: boolean;
  secondaryBadge?: {
    label: string;
    tone?: BadgeTone;
  } | null;
  meta?: ReactNode;
  className?: string;
};

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const badgeToneStyles: Record<BadgeTone, string> = {
  default: "border-slate-200 bg-slate-100 text-slate-600",
  verified: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

const initialsForName = (name?: string | null) =>
  (name || "Guest")
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

const resolveProfileBadge = (profile: GuestProfilePreview | null) => {
  const isComplete = Boolean(
    profile?.full_name?.trim() &&
      profile?.headline?.trim() &&
      profile?.bio?.trim() &&
      profile?.avatar_url
  );

  return isComplete
    ? { label: "Profile complete", tone: "verified" as const }
    : { label: "Profile pending", tone: "default" as const };
};

export default function GuestProfilePreviewCard({
  profile,
  compact = false,
  emailVerified = false,
  showProfessionalPlaceholder: _showProfessionalPlaceholder = false,
  secondaryBadge,
  meta,
  className,
}: Props) {
  const displayName = profile?.full_name?.trim() || "Guest";
  const headline = profile?.headline?.trim() || "No headline yet";
  const bio = profile?.bio?.trim() || null;
  const profileBadge = resolveProfileBadge(profile);

  return (
    <div
      className={joinClasses(
        "rounded-2xl border border-slate-200 bg-white",
        compact ? "p-4" : "p-5",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar className={joinClasses("border border-slate-200 bg-slate-100", compact ? "h-11 w-11" : "h-14 w-14")}>
          {profile?.avatar_url ? (
            <AvatarImage src={profile.avatar_url} alt={displayName} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-slate-100 text-sm font-semibold text-slate-600">
            {initialsForName(displayName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={joinClasses("font-semibold text-slate-900", compact ? "text-sm" : "text-base")}>
              {displayName}
            </p>
            {secondaryBadge ? (
              <span
                className={joinClasses(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  badgeToneStyles[secondaryBadge.tone ?? "default"]
                )}
              >
                {secondaryBadge.label}
              </span>
            ) : null}
          </div>

          <p className={joinClasses("mt-1 text-slate-600", compact ? "text-xs" : "text-sm")}>{headline}</p>
          {bio ? (
            <p className={joinClasses("mt-2 line-clamp-2 text-slate-500", compact ? "text-xs leading-5" : "text-sm leading-6")}>
              {bio}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <TrustBadge type="profile_complete" label={profileBadge.label} />
            {emailVerified ? <TrustBadge type="email_verified" /> : null}
          </div>
          {meta ? <div className="mt-2">{meta}</div> : null}
        </div>
      </div>
    </div>
  );
}
