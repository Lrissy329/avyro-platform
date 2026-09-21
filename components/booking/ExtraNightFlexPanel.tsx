type ExtraNightFlexPanelProps = {
  optionalNightPriceLabel?: string | null;
  noticeHours: number;
};

export default function ExtraNightFlexPanel({
  optionalNightPriceLabel,
  noticeHours,
}: ExtraNightFlexPanelProps) {
  return (
    <div className="space-y-1 rounded-lg bg-slate-50/70 px-3 py-2.5">
      <p className="text-sm font-semibold text-slate-900">Optional extra night</p>
      {optionalNightPriceLabel ? (
        <p className="text-sm text-slate-900">
          <span className="font-mono font-semibold tabular-nums">{optionalNightPriceLabel}</span> if
          you use it
        </p>
      ) : null}
      <p className="text-xs leading-5 text-slate-600">
        Confirm at least {noticeHours} hours before checkout. Your card is saved securely with
        Stripe, and the extra night is only charged if you confirm it.
      </p>
    </div>
  );
}
