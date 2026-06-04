import {
  BusFront,
  CarFront,
  CarTaxiFront,
  PlaneTakeoff,
  TrainFront,
} from "lucide-react";

type Props = {
  airportCode?: string | null;
  driveMinutes?: number | null;
  taxiMinutes?: number | null;
  publicTransportMinutes?: number | null;
  publicTransportModes?: string[] | null;
};

type AccessRow = {
  label: string;
  value: string;
  Icon: typeof CarFront;
};

const AIRPORT_NAME_MAP: Record<string, string> = {
  STN: "London Stansted Airport",
  LHR: "London Heathrow Airport",
  LGW: "London Gatwick Airport",
  LTN: "London Luton Airport",
  MAN: "Manchester Airport",
  BHX: "Birmingham Airport",
  DUB: "Dublin Airport",
};

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const formatMinutes = (minutes?: number | null, suffix?: string) => {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  return `${rounded} min${suffix ? ` ${suffix}` : ""}`;
};

const modeSetFrom = (modes?: string[] | null) =>
  new Set(
    (modes ?? [])
      .map((mode) => String(mode ?? "").trim().toUpperCase())
      .filter(Boolean)
  );

function AccessItem({ label, value, Icon }: AccessRow) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white/80 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
        <span className="text-sm font-medium text-slate-700">{label}</span>
      </div>
      <span className="text-right text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

export default function AirportAccessCard({
  airportCode,
  driveMinutes,
  taxiMinutes,
  publicTransportMinutes,
  publicTransportModes,
}: Props) {
  const normalizedCode =
    typeof airportCode === "string" && airportCode.trim() ? airportCode.trim().toUpperCase() : null;
  const airportName = normalizedCode ? AIRPORT_NAME_MAP[normalizedCode] ?? `${normalizedCode} Airport` : null;
  modeSetFrom(publicTransportModes);
  void publicTransportMinutes;

  const rows: AccessRow[] = [
    {
      label: "Drive",
      value: formatMinutes(driveMinutes, "estimate") ?? "Coming soon",
      Icon: CarFront,
    },
    {
      label: "Taxi",
      value: formatMinutes(taxiMinutes, "estimate") ?? "Coming soon",
      Icon: CarTaxiFront,
    },
    {
      label: "Bus",
      value: "Coming soon",
      Icon: BusFront,
    },
    {
      label: "Train",
      value: "Coming soon",
      Icon: TrainFront,
    },
  ];

  return (
    <section className="rounded-[1.75rem] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-lg font-semibold text-slate-900">Airport access</p>
          <p className="text-sm text-slate-500">
            Practical travel options for getting to the airport.
          </p>
        </div>
        {normalizedCode ? (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800">
            {normalizedCode}
          </span>
        ) : null}
      </div>

      {normalizedCode && airportName ? (
        <>
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/85 px-3.5 py-3 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <PlaneTakeoff className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{airportName}</p>
              <p className="text-xs text-slate-500">{normalizedCode} airport access</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {rows.map((row) => (
              <AccessItem key={row.label} {...row} />
            ))}
          </div>

          <div className="mt-4 space-y-1.5">
            <p className="text-sm font-medium text-slate-700">
              Designed for early starts, late finishes, and repeat airport trips.
            </p>
            <p className="text-xs text-slate-500">
              Travel times are estimates and may vary by time of day.
            </p>
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3.5 py-4">
          <p className="text-sm font-medium text-slate-700">Airport access details coming soon.</p>
          <p className="mt-1 text-sm text-slate-500">
            We’ll surface practical airport travel estimates here once this stay’s access details are confirmed.
          </p>
        </div>
      )}
    </section>
  );
}
