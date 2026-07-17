import type { ReactNode } from "react";

type OpsFilterBarProps = {
  children: ReactNode;
  method?: "get" | "post";
  action?: string;
};

export default function OpsFilterBar({ children, method = "get", action }: OpsFilterBarProps) {
  return (
    <form
      method={method}
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4"
    >
      {children}
    </form>
  );
}
