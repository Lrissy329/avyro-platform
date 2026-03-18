import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

type GuestTripsSectionProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  collapsed?: boolean;
  actionSlot?: ReactNode;
};

export function GuestTripsSection({
  title,
  description,
  children,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  collapsed,
  actionSlot,
}: GuestTripsSectionProps) {
  return (
    <section className={collapsed ? "space-y-3" : "space-y-4"}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {actionSlot}
      </div>

      {children ? (
        children
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">{emptyTitle ?? `No ${title.toLowerCase()} yet.`}</p>
          {emptyDescription ? <p className="mt-1 text-sm text-slate-500">{emptyDescription}</p> : null}
          {emptyActionLabel && onEmptyAction ? (
            <div className="mt-4">
              <Button
                type="button"
                onClick={onEmptyAction}
                className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
              >
                {emptyActionLabel}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
