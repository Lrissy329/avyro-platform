import Link from "next/link";
import type { ReactNode } from "react";
import OpsStatusBadge, { type OpsStatusTone } from "@/components/ops/OpsStatusBadge";

type OpsAlertRowProps = {
  title: string;
  detail: string;
  meta?: string;
  href?: string;
  tone?: OpsStatusTone;
  badgeLabel?: string;
  trailing?: ReactNode;
};

export default function OpsAlertRow({
  title,
  detail,
  meta,
  href,
  tone = "default",
  badgeLabel,
  trailing,
}: OpsAlertRowProps) {
  const content = (
    <div className={`flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 transition ${href ? "hover:border-slate-300 hover:bg-slate-50" : "bg-slate-50/70"}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{detail}</p>
        {meta ? <p className="mt-1 text-xs text-slate-500">{meta}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {trailing}
        {badgeLabel ? <OpsStatusBadge label={badgeLabel} tone={tone} /> : null}
      </div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
