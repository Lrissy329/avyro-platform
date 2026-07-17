import type { ReactNode } from "react";

type OpsTableProps = {
  gridClassName: string;
  columns: string[];
  children: ReactNode;
};

export default function OpsTable({ gridClassName, columns, children }: OpsTableProps) {
  return (
    <div className="overflow-x-auto rounded-[18px] border border-slate-200 bg-white">
      <div className={`min-w-[860px] ${gridClassName}`}>
        <div
          className={`${gridClassName} border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700`}
        >
          {columns.map((column) => (
            <span key={column}>{column}</span>
          ))}
        </div>
        <div className="divide-y divide-slate-200">{children}</div>
      </div>
    </div>
  );
}
