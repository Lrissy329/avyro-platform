import { BusFront, CarTaxiFront, TrainFront } from "lucide-react";

import { classifyTransitModes, isValidClockTime } from "@/lib/transportTimes";

type Props = {
  airportCode?: string | null;
  // Minutes and distance for the road journey (car or taxi), from listing_transport_summaries.
  taxiMinutes?: number | null;
  distanceKm?: number | null;
  publicTransportMinutes?: number | null;
  publicTransportModes?: string[] | null;
  publicTransportTransfers?: number | null;
  // Earliest public-transport departure found from about 04:00, "HH:MM" local time.
  publicTransportFirstDeparture?: string | null;
  // Optional Google Maps directions link from the stay to the airport.
  directionsUrl?: string | null;
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

const toMinutes = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

function AccessRow({
  Icon,
  label,
  detail,
  minutes,
}: {
  Icon: typeof BusFront;
  label: string;
  detail?: string | null;
  minutes: number;
}) {
  return (
    <li className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {detail ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{detail}</p> : null}
      </div>
      <p className="shrink-0 text-right text-slate-900">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{minutes}</span>
        <span className="ml-1 text-sm font-medium text-slate-500">min</span>
      </p>
    </li>
  );
}

export default function AirportAccessCard({
  airportCode,
  taxiMinutes,
  distanceKm,
  publicTransportMinutes,
  publicTransportModes,
  publicTransportTransfers,
  publicTransportFirstDeparture,
  directionsUrl,
}: Props) {
  const code =
    typeof airportCode === "string" && airportCode.trim() ? airportCode.trim().toUpperCase() : null;
  const airportName = code ? AIRPORT_NAME_MAP[code] ?? `${code} Airport` : null;

  const roadMinutes = toMinutes(taxiMinutes);
  const transitMinutes = toMinutes(publicTransportMinutes);

  const roadDetail =
    typeof distanceKm === "number" && Number.isFinite(distanceKm) && distanceKm > 0
      ? `${distanceKm.toFixed(1)} km`
      : null;

  const kind = classifyTransitModes(publicTransportModes);
  const transitLabel = kind === "bus" ? "By bus" : kind === "train" ? "By train" : "By public transport";
  const TransitIcon = kind === "train" ? TrainFront : BusFront;
  const changes =
    typeof publicTransportTransfers === "number" && Number.isFinite(publicTransportTransfers)
      ? publicTransportTransfers <= 0
        ? "Direct"
        : `${publicTransportTransfers} change${publicTransportTransfers === 1 ? "" : "s"}`
      : null;
  const firstService = isValidClockTime(publicTransportFirstDeparture)
    ? `first service ${publicTransportFirstDeparture}`
    : null;
  const transitDetail = [changes, firstService].filter(Boolean).join(" · ") || null;

  const hasTimes = roadMinutes != null || transitMinutes != null;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {airportName ? `Getting to ${airportName}` : "Getting to the airport"}
          </h2>
          {hasTimes ? (
            <p className="mt-1 text-sm text-slate-500">Typical journey time from this stay.</p>
          ) : null}
        </div>
        {directionsUrl ? (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 underline-offset-4 hover:text-slate-900 hover:underline"
          >
            Get directions <span aria-hidden>→</span>
          </a>
        ) : null}
      </div>

      {hasTimes ? (
        <>
          <ul className="mt-5 divide-y divide-slate-100">
            {roadMinutes != null ? (
              <AccessRow Icon={CarTaxiFront} label="By car or taxi" detail={roadDetail} minutes={roadMinutes} />
            ) : null}
            {transitMinutes != null ? (
              <AccessRow Icon={TransitIcon} label={transitLabel} detail={transitDetail} minutes={transitMinutes} />
            ) : null}
          </ul>
          <p className="mt-5 text-xs leading-5 text-slate-500">
            Estimates for a quiet weekday. Allow extra at busy times, and check public transport if you
            travel very early or late.
          </p>
        </>
      ) : (
        <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Travel times for this stay haven&apos;t been calculated yet.
          {directionsUrl ? " You can check the route yourself with the directions link." : ""}
        </p>
      )}
    </section>
  );
}
