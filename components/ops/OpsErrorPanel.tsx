type OpsErrorPanelProps = {
  title?: string;
  messages: string[];
};

export default function OpsErrorPanel({
  title = "Operational alerts",
  messages,
}: OpsErrorPanelProps) {
  if (!messages.length) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-slate-900">
      <p className="font-medium text-amber-900">{title}</p>
      <ul className="mt-2 space-y-1 text-amber-900/80">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
