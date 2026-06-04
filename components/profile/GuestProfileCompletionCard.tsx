type Props = {
  items: Array<{
    label: string;
    complete: boolean;
    hint: string;
  }>;
};

export default function GuestProfileCompletionCard({ items }: Props) {
  const completed = items.filter((item) => item.complete).length;
  const total = items.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Profile completion</h3>
          <p className="mt-1 text-sm text-slate-500">
            Complete the core fields hosts expect to see before accepting a booking.
          </p>
        </div>
        <div className="rounded-full bg-slate-900 px-3 py-1 text-sm font-semibold text-white">
          {progress}%
        </div>
      </div>

      <div className="mt-5 h-2 rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">{item.label}</p>
              <p className="mt-1 text-sm text-slate-500">{item.hint}</p>
            </div>
            <span
              className={`mt-0.5 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                item.complete
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {item.complete ? "Complete" : "Pending"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
