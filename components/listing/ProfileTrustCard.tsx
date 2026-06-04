import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type Props = {
  name: string;
  avatarUrl?: string | null;
  eyebrow?: string;
  title: string;
  subtitle?: string | null;
  badge: string;
  badgeTone?: "verified" | "default";
  supportingText?: string | null;
  facts?: string[];
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
  action,
  compact = false,
  className,
}: Props) {
  return (
    <div
      className={joinClasses(
        "rounded-3xl border border-slate-200 bg-white shadow-sm",
        compact ? "p-5" : "p-6",
        className
      )}
    >
      <div className={joinClasses("flex gap-4", compact ? "items-center" : "items-start")}>
        <Avatar
          className={joinClasses(
            "border border-slate-200 bg-slate-100",
            compact ? "h-14 w-14" : "h-20 w-20"
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
          </div>

          <h3 className={joinClasses("mt-2 font-semibold text-slate-900", compact ? "text-lg" : "text-2xl")}>
            {title}
          </h3>
          {subtitle ? <p className="mt-1 text-sm font-medium text-slate-600">{subtitle}</p> : null}
          {supportingText ? (
            <p className={joinClasses("text-sm leading-6 text-slate-600", compact ? "mt-2" : "mt-3")}>
              {supportingText}
            </p>
          ) : null}

          {(facts.length > 0 || action) && (
            <div className={joinClasses("flex flex-wrap items-center gap-3", compact ? "mt-3" : "mt-5")}>
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
