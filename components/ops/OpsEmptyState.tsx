type OpsEmptyStateProps = {
  title: string;
  detail?: string;
};

export default function OpsEmptyState({ title, detail }: OpsEmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
      <p className="font-medium text-slate-700">{title}</p>
      {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
    </div>
  );
}
