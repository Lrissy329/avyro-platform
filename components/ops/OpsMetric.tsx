import Link from "next/link";
import OpsStatusBadge, { type OpsStatusTone } from "@/components/ops/OpsStatusBadge";

type OpsMetricProps = {
  label: string;
  value: string;
  detail?: string;
  href?: string;
  tone?: OpsStatusTone;
  statusLabel?: string;
  dominant?: boolean;
};

export default function OpsMetric({
  label,
  value,
  detail,
  href,
  tone = "default",
  statusLabel,
  dominant = false,
}: OpsMetricProps) {
  const content = (
    <div
      className={`flex min-w-[180px] flex-1 items-start justify-between gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3 transition ${
        href ? "hover:border-slate-300 hover:bg-slate-50" : ""
      } ${dominant ? "md:min-w-[280px]" : ""}`}
    >
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p
          className={`mt-2 font-semibold tracking-tight text-slate-950 ${
            dominant ? "text-2xl" : "text-xl"
          }`}
        >
          {value}
        </p>
        {detail ? <p className="mt-1.5 text-xs text-slate-600">{detail}</p> : null}
      </div>
      {statusLabel ? <OpsStatusBadge label={statusLabel} tone={tone} /> : null}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
