type OpsSearchBarProps = {
  name?: string;
  defaultValue?: string;
  placeholder: string;
  buttonLabel?: string;
};

export default function OpsSearchBar({
  name = "q",
  defaultValue,
  placeholder,
  buttonLabel = "Search",
}: OpsSearchBarProps) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
