import type { ReactNode } from "react";

type HostPageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
};

export function HostPageHeader({ title, description, actions }: HostPageHeaderProps) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-slate-600">{description}</p>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 mb-6 border-b border-slate-200" />
    </div>
  );
}
