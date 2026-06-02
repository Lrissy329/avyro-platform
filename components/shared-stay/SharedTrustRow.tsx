type SharedTrustRowProps = {
  professionalsOnly?: boolean;
  individualBooking?: boolean;
  noSharedPayment?: boolean;
};

const trustItems = [
  { key: "professionalsOnly", label: "Professionals only" },
  { key: "individualBooking", label: "Individual booking" },
  { key: "noSharedPayment", label: "No shared payment" },
] as const;

export function SharedTrustRow({
  professionalsOnly = true,
  individualBooking = true,
  noSharedPayment = true,
}: SharedTrustRowProps) {
  const values = {
    professionalsOnly,
    individualBooking,
    noSharedPayment,
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {trustItems
        .filter((item) => values[item.key])
        .map((item) => (
          <span
            key={item.key}
            className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
          >
            {item.label}
          </span>
        ))}
    </div>
  );
}

