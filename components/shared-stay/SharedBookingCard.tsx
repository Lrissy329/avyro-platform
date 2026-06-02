type SharedBookingCardProps = {
  listingTitle: string;
  dateRangeLabel: string;
  perPersonWeeklyPricePence?: number | null;
  amountPaidPence?: number | null;
  groupStatus?: string | null;
  occupancy?: {
    filled?: number | null;
    total?: number | null;
  } | null;
};

const formatCurrency = (valuePence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valuePence / 100);

export function SharedBookingCard({
  listingTitle,
  dateRangeLabel,
  perPersonWeeklyPricePence,
  amountPaidPence,
  groupStatus,
  occupancy,
}: SharedBookingCardProps) {
  const normalizedStatus = String(groupStatus ?? "confirmed").replaceAll("_", " ");

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">Shared stay</p>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
          {normalizedStatus}
        </span>
      </div>

      <p className="mt-2 text-sm font-medium text-slate-900">{listingTitle}</p>
      <p className="mt-1 text-sm text-slate-600">{dateRangeLabel}</p>

      <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <p>
          Per person / week: {typeof perPersonWeeklyPricePence === "number" ? formatCurrency(perPersonWeeklyPricePence) : "—"}
        </p>
        <p>
          Paid: {typeof amountPaidPence === "number" ? formatCurrency(amountPaidPence) : "—"}
        </p>
        {occupancy?.total != null ? (
          <p className="sm:col-span-2">
            {Math.max(0, Math.round(Number(occupancy.filled ?? 0) || 0))} of{" "}
            {Math.max(1, Math.round(Number(occupancy.total ?? 1) || 1))} spots filled
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-slate-600">Each guest books and pays individually.</p>
    </section>
  );
}
