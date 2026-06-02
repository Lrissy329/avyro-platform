type ExtraNightFlexPanelProps = {
  optionalNightPriceLabel?: string | null;
  noticeHours: number;
};

export default function ExtraNightFlexPanel({
  optionalNightPriceLabel,
  noticeHours,
}: ExtraNightFlexPanelProps) {
  return (
    <div className="space-y-1.5 rounded-lg bg-slate-50/70 px-3 py-2.5">
      <p className="text-sm font-semibold text-slate-900">Extra night</p>
      <p className="text-xs text-slate-600">Stay flexible if plans change.</p>
      <p className="pt-1 text-sm font-medium text-slate-900">+1 optional night available</p>
      {optionalNightPriceLabel ? (
        <div className="pt-0.5">
          <p className="font-mono text-sm font-semibold text-slate-900">
            {optionalNightPriceLabel} if used
          </p>
        </div>
      ) : null}
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">
        <li>No rebooking required</li>
        <li>Confirm {noticeHours} hours before checkout</li>
      </ul>
    </div>
  );
}
