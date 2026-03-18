import type { ReactNode } from "react";

type GuestPageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
};

export function GuestPageHeader({ title, description, actions }: GuestPageHeaderProps) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-slate-600">{description}</p>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mb-6 mt-4 border-b border-slate-200" />
    </div>
  );
}
