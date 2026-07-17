import type { ReactNode } from "react";

type OpsPageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export default function OpsPageHeader({
  title,
  description,
  actions,
  children,
}: OpsPageHeaderProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-950">{title}</h1>
          {description ? <p className="mt-1.5 text-sm text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="w-full md:w-auto md:min-w-[280px]">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
