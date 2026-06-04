import type { ReactNode } from "react";

import TrustBadge, { type TrustBadgeType } from "@/components/trust/TrustBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type Props = {
  name: string;
  avatarUrl?: string | null;
  eyebrow?: string;
  title: string;
  subtitle?: string | null;
  badge?: string;
  badgeTone?: "verified" | "default";
  supportingText?: string | null;
  facts?: string[];
  trustBadges?: Array<{
    type: TrustBadgeType;
    label?: string;
  }>;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const initialsForName = (name: string) =>
  name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

export default function ProfileTrustCard({
  name,
  avatarUrl,
  eyebrow,
  title,
  subtitle,
  badge,
  badgeTone = "default",
  supportingText,
  facts = [],
  trustBadges = [],
  action,
  compact = false,
  className,
}: Props) {
  return (
    <div
      className={joinClasses(
        "rounded-3xl border border-slate-200 bg-white shadow-sm",
        compact ? "p-4 sm:p-4" : "p-6",
        className
      )}
    >
      <div className={joinClasses("flex gap-4", compact ? "items-start gap-3" : "items-start")}>
        <Avatar
          className={joinClasses(
            "border border-slate-200 bg-slate-100",
            compact ? "h-12 w-12" : "h-20 w-20"
          )}
        >
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} className="object-cover" /> : null}
          <AvatarFallback className="bg-slate-100 text-sm font-semibold text-slate-600">
            {initialsForName(name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow ? (
              <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                {eyebrow}
              </span>
            ) : null}
            {badge ? (
              <span
                className={joinClasses(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  badgeTone === "verified"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                )}
              >
                {badge}
              </span>
            ) : null}
          </div>

          <h3 className={joinClasses("font-semibold text-slate-900", compact ? "mt-0.5 text-base leading-5" : "mt-2 text-2xl")}>
            {title}
          </h3>
          {trustBadges.length > 0 ? (
            <div className={joinClasses("flex flex-wrap gap-2", compact ? "mt-1.5" : "mt-4")}>
              {trustBadges.map((item) => (
                <TrustBadge
                  key={`${item.type}-${item.label ?? "default"}`}
                  type={item.type}
                  label={item.label}
                />
              ))}
            </div>
          ) : null}
          {subtitle ? (
            <p className={joinClasses("font-medium text-slate-600", compact ? "mt-1 text-sm" : "mt-1 text-sm")}>
              {subtitle}
            </p>
          ) : null}
          {supportingText ? (
            <p className={joinClasses("text-sm text-slate-600", compact ? "mt-1.5 leading-5" : "mt-3 leading-6")}>
              {supportingText}
            </p>
          ) : null}

          {(facts.length > 0 || action) && (
            <div className={joinClasses("flex flex-wrap items-center gap-3", compact ? "mt-2.5" : "mt-5")}>
              {facts.map((fact) => (
                <span
                  key={fact}
                  className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
                >
                  {fact}
                </span>
              ))}
              {action}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
