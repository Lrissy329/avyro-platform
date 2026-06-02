type SharedStayFilterProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export function SharedStayFilter({ checked, onChange, className = "" }: SharedStayFilterProps) {
  return (
    <label className={`flex items-start gap-3 text-sm ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-[#FEDD02] focus:ring-[#FEDD02]"
      />
      <span>
        <span className="block font-medium text-slate-800">Shared stays</span>
        <span className="block text-xs text-slate-500">Join an existing group or start a new one.</span>
      </span>
    </label>
  );
}
