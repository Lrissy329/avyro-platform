import { useState, useEffect } from "react";
import type { DateRange } from "@/lib/calendarTypes";
import { formatRangeSummary } from "@/lib/dateUtils";

type PriceModalProps = {
  open: boolean;
  listingId: string;
  range: DateRange;
  onClose: () => void;
  onSave: (opts: {
    listingId: string;
    range: DateRange;
    price: number;
    currency: string;
  }) => Promise<void>;
};

export function PriceModal({
  open,
  listingId,
  range,
  onClose,
  onSave,
}: PriceModalProps) {
  const [price, setPrice] = useState<string>("");
  const [currency, setCurrency] = useState("GBP");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPrice("");
    setCurrency("GBP");
    setSaving(false);
    setError(null);
  }, [open, listingId, range]);

  if (!open) return null;

  const handleSubmit = async () => {
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError("Enter a nightly price greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ listingId, range, price: numericPrice, currency });
      onClose();
    } catch (err) {
      console.error(err);
      setError("Unable to update prices. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Edit nightly price
            </p>
            <h2 className="text-lg font-semibold text-slate-900">
              {formatRangeSummary(range.start, range.end)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            New nightly price
            <input
              type="number"
              min="1"
              step="1"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 250"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Currency
            <select
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          {error && <p className="text-sm text-[#E5484D]">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-full bg-slate-900 px-5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save prices"}
          </button>
        </div>
      </div>
    </div>
  );
}
