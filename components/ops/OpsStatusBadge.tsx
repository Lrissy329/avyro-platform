export type OpsStatusTone = "default" | "warning" | "danger" | "success" | "info";

type OpsStatusBadgeProps = {
  label: string;
  tone?: OpsStatusTone;
};

const TONE_STYLES: Record<OpsStatusTone, string> = {
  default: "border-slate-200 bg-slate-100 text-slate-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

export default function OpsStatusBadge({ label, tone = "default" }: OpsStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${TONE_STYLES[tone]}`}
    >
      {label}
    </span>
  );
}
