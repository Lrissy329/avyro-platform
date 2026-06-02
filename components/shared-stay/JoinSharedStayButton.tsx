type JoinSharedStayButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function JoinSharedStayButton({
  onClick,
  disabled,
  loading,
}: JoinSharedStayButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={Boolean(disabled) || Boolean(loading)}
      className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Joining…" : "Join this stay"}
    </button>
  );
}

