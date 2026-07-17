import type { ReactNode } from "react";

type OpsSectionProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  compact?: boolean;
};

export default function OpsSection({
  title,
  description,
  actions,
  children,
  compact = false,
}: OpsSectionProps) {
  return (
    <section
      className={`rounded-[18px] border border-slate-200 bg-white ${
        compact ? "p-4" : "p-5"
      }`}
    >
      {title || description || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? <h2 className="text-base font-semibold text-slate-900">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
