type StartSharedGroupButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function StartSharedGroupButton({
  onClick,
  disabled,
  loading,
}: StartSharedGroupButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={Boolean(disabled) || Boolean(loading)}
      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Starting…" : "Start a new shared stay"}
    </button>
  );
}
