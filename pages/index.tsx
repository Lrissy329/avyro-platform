import Image from "next/image";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import SearchBar from "@/components/SearchBar";
import { isMissingColumnError } from "@/lib/flexStay";
import { computeGuestStayPricing, computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";
import { SHARED_STAYS_ENABLED } from "@/lib/featureFlags";
import { SUPPORT_EMAIL } from "@/lib/support";
import { withTransportSummaries } from "@/lib/transportSummaries";
import { supabase } from "@/lib/supabaseClient";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const AIRPORT_LABELS: Record<string, string> = {
  BHX: "Birmingham",
  DUB: "Dublin",
  LGW: "London Gatwick",
  LHR: "London Heathrow",
  LTN: "London Luton",
  MAN: "Manchester",
  STN: "London Stansted",
};

type ListingRow = {
  id: string;
  title: string;
  airportCode: string;
  bookingUnit: "nightly" | "hourly";
  isSharedStay: boolean;
  priceLabel: string;
  priceValue: number;
  travelMinutes: number | null;
  locationLabel: string | null;
};

type AirportSummary = {
  code: string;
  name: string;
  listingCount: number;
  averageMinutes: number | null;
};

type AirportCard = AirportSummary & { comingSoon: boolean };

// Stansted is the launch airport. Airports below only appear as "Coming soon"
// until they have live stays of their own.
const LAUNCH_AIRPORT_CODE = "STN";
const COMING_SOON_AIRPORT_CODES = ["LHR", "DUB", "MAN"];

// Development-only visual samples for the hero card. Never shown in production.
const PREVIEW_LISTINGS: ListingRow[] = [
  {
    id: "preview-bath-road-studios",
    title: "Bath Road Studios",
    airportCode: "LHR",
    bookingUnit: "nightly",
    isSharedStay: false,
    priceLabel: "£64/nt",
    priceValue: 64,
    travelMinutes: 6,
    locationLabel: "Heathrow",
  },
  {
    id: "preview-hatton-cross-suites",
    title: "Hatton Cross Suites",
    airportCode: "LHR",
    bookingUnit: "nightly",
    isSharedStay: true,
    priceLabel: "£41/wk pp",
    priceValue: 41,
    travelMinutes: 9,
    locationLabel: "Hatton Cross",
  },
  {
    id: "preview-poyle-loft",
    title: "Poyle Loft",
    airportCode: "LHR",
    bookingUnit: "nightly",
    isSharedStay: false,
    priceLabel: "£52/nt",
    priceValue: 52,
    travelMinutes: 12,
    locationLabel: "Heathrow",
  },
];

type SimpleIconProps = {
  className?: string;
};

const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const CardIcon = ({ className }: SimpleIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="M3.5 10.5h17" />
  </svg>
);

const AirportPinIcon = ({ className }: SimpleIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <path d="M20 10c0 5.1-8 11-8 11S4 15.1 4 10a8 8 0 1 1 16 0Z" />
    <path d="m9.2 11 5.6-2.1-2.1 5.6-1.4-2.1L9.2 11Z" />
  </svg>
);

const CalendarRangeIcon = ({ className }: SimpleIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
    <path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17M8 15h3M13 15h3" />
  </svg>
);

const CardCheckIcon = ({ className }: SimpleIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="M3.5 10h17m-5.5 4 1.5 1.5 3-3" />
  </svg>
);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const shortLocation = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} / ${parts[1]}`;
};

const sharedPriceMajor = (row: Record<string, unknown>) => {
  const totalWeeklyPence = toNumber(row.shared_weekly_price_pence);
  const totalSpots = Math.max(1, Math.round(toNumber(row.shared_total_spots) ?? 1));
  if (totalWeeklyPence == null || totalWeeklyPence <= 0) return null;

  return (
    computeSharedPerPersonWeeklyPricePence({
      totalWeeklyPricePence: totalWeeklyPence,
      totalSpots,
    }).rounded_per_person_weekly_pence / 100
  );
};

const listingSearchHref = (
  code: string,
  name: string,
  extras?: Record<string, string>
) => ({
  pathname: "/search",
  query: {
    airport: code,
    location: `${name} (${code})`,
    ...extras,
  },
});

const normalizeListing = (row: Record<string, unknown>): ListingRow | null => {
  const id = typeof row.id === "string" ? row.id : null;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const airportCode =
    typeof row.airport_code === "string" ? row.airport_code.trim().toUpperCase() : "";
  if (!id || !title || !airportCode) return null;

  const isSharedStay = Boolean(row.is_shared_stay);
  const bookingUnit = row.booking_unit === "hourly" ? "hourly" : "nightly";
  const minutes =
    toNumber(row.drive_minutes_offpeak) ??
    toNumber(row.taxi_typical_minutes) ??
    toNumber(row.taxi_duration_minutes);
  const hostUnitPrice =
    bookingUnit === "hourly" ? toNumber(row.price_per_hour) : toNumber(row.price_per_night);
  // Show the guest's all-inclusive price (same helper as the search cards), never the host's raw price.
  const priceValue = isSharedStay
    ? sharedPriceMajor(row)
    : hostUnitPrice != null && hostUnitPrice > 0
    ? computeGuestStayPricing({
        hostNetUnitMajor: hostUnitPrice,
        units: 1,
        bookingUnit,
        isFirstCompletedBooking: false,
      }).guest_unit_avg_major
    : null;

  if (priceValue == null || priceValue <= 0) return null;

  return {
    id,
    title,
    airportCode,
    bookingUnit,
    isSharedStay,
    priceValue,
    priceLabel: isSharedStay
      ? `${formatCurrency(priceValue)}/wk pp`
      : bookingUnit === "hourly"
      ? `${formatCurrency(priceValue)}/hr`
      : `${formatCurrency(priceValue)}/nt`,
    travelMinutes: minutes != null ? Math.round(minutes) : null,
    locationLabel: shortLocation(row.location),
  };
};

const SectionHeader = ({
  eyebrow,
  title,
  body,
  action,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  action?: ReactNode;
  dark?: boolean;
}) => (
  <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end lg:gap-16">
    <div>
      <p
        className={cx(
          "text-xs font-semibold uppercase tracking-[0.18em]",
          dark ? "text-[#FEDD02]" : "text-[#8a6a00]"
        )}
      >
        {eyebrow}
      </p>
      <h2
        className={cx(
          inter.className,
          "mt-4 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-5xl lg:text-[3.5rem]",
          dark ? "text-white" : "text-slate-950"
        )}
      >
        {title}
      </h2>
    </div>
    {body || action ? (
      <div>
        {body ? (
          <p className={cx("text-lg leading-8", dark ? "text-white/70" : "text-slate-600")}>{body}</p>
        ) : null}
        {action}
      </div>
    ) : null}
  </div>
);

export default function Home() {
  const router = useRouter();
  const [liveListings, setLiveListings] = useState<ListingRow[]>([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const isPreviewMode =
    process.env.NODE_ENV === "development" && router.query.previewListings !== "false";

  useEffect(() => {
    let active = true;

    async function loadHomepageListings() {
      setLoadingListings(true);

      // The transport columns are not in every environment's database yet. If they are missing, retry
      // without them instead of failing and showing no listings (schema-drift pattern, see CLAUDE.md).
      const baseColumns =
        "id, title, airport_code, location, booking_unit, price_per_night, price_per_hour, is_shared_stay, shared_total_spots, shared_weekly_price_pence";
      const transportColumns = ", drive_minutes_offpeak, taxi_typical_minutes, taxi_duration_minutes";
      const fetchRows = (columns: string) => {
        let query = supabase
          .from("listings")
          .select(columns)
          .not("airport_code", "is", null)
          // MVP: same as search, nightly inventory only.
          .or("booking_unit.eq.nightly,booking_unit.is.null");
        // SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md
        // Shared listings are excluded from the homepage while the feature is off.
        if (!SHARED_STAYS_ENABLED) query = query.not("is_shared_stay", "is", true);
        return query.order("created_at", { ascending: false }).limit(60);
      };

      let result: { data: unknown; error: { code?: string; message?: string } | null } =
        await fetchRows(baseColumns + transportColumns);
      if (result.error && isMissingColumnError(result.error)) {
        result = await fetchRows(baseColumns);
      }
      const { data, error } = result;

      if (!active) return;

      if (error || !Array.isArray(data)) {
        setLiveListings([]);
        setLoadingListings(false);
        return;
      }

      const withTimes = await withTransportSummaries(
        supabase,
        data as unknown as Array<{ id?: unknown; [key: string]: unknown }>
      );
      const normalized = withTimes
        .map((row) => normalizeListing(row as Record<string, unknown>))
        .filter((row): row is ListingRow => Boolean(row))
        .sort((a, b) => {
          const minutesA = a.travelMinutes ?? 999;
          const minutesB = b.travelMinutes ?? 999;
          if (minutesA !== minutesB) return minutesA - minutesB;
          return a.priceValue - b.priceValue;
        });

      setLiveListings(normalized);
      setLoadingListings(false);
    }

    loadHomepageListings().catch(() => {
      if (!active) return;
      setLiveListings([]);
      setLoadingListings(false);
    });

    return () => {
      active = false;
    };
  }, []);

  // SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md (the dev-only preview sample includes a shared listing)
  const homepageListings = isPreviewMode
    ? PREVIEW_LISTINGS.filter((listing) => SHARED_STAYS_ENABLED || !listing.isSharedStay)
    : liveListings;
  const previewListings = useMemo(() => homepageListings.slice(0, 3), [homepageListings]);

  // Everything below the hero is built from real listings only, never preview data.
  const dataAirportSummaries = useMemo<AirportSummary[]>(() => {
    const grouped = new Map<string, { count: number; minuteTotal: number; minuteCount: number }>();

    liveListings.forEach((listing) => {
      const current = grouped.get(listing.airportCode) ?? {
        count: 0,
        minuteTotal: 0,
        minuteCount: 0,
      };

      current.count += 1;
      if (listing.travelMinutes != null) {
        current.minuteTotal += listing.travelMinutes;
        current.minuteCount += 1;
      }
      grouped.set(listing.airportCode, current);
    });

    return Array.from(grouped.entries())
      .map(([code, value]) => ({
        code,
        name: AIRPORT_LABELS[code] ?? code,
        listingCount: value.count,
        averageMinutes:
          value.minuteCount > 0 ? Math.round(value.minuteTotal / value.minuteCount) : null,
      }))
      .sort((a, b) => b.listingCount - a.listingCount);
  }, [liveListings]);

  // Launch airport first (even before it has stays), then any other airport with
  // real stays, then "Coming soon" placeholders for airports without any yet.
  const airportCards = useMemo<AirportCard[]>(() => {
    const liveByCode = new Map(dataAirportSummaries.map((airport) => [airport.code, airport]));

    const launch: AirportCard = {
      ...(liveByCode.get(LAUNCH_AIRPORT_CODE) ?? {
        code: LAUNCH_AIRPORT_CODE,
        name: AIRPORT_LABELS[LAUNCH_AIRPORT_CODE] ?? LAUNCH_AIRPORT_CODE,
        listingCount: 0,
        averageMinutes: null,
      }),
      comingSoon: false,
    };
    const otherLive = dataAirportSummaries
      .filter((airport) => airport.code !== LAUNCH_AIRPORT_CODE)
      .map((airport) => ({ ...airport, comingSoon: false }));
    const comingSoon = COMING_SOON_AIRPORT_CODES.filter((code) => !liveByCode.has(code)).map(
      (code) => ({
        code,
        name: AIRPORT_LABELS[code] ?? code,
        listingCount: 0,
        averageMinutes: null,
        comingSoon: true,
      })
    );

    return [launch, ...otherLive, ...comingSoon].slice(0, 4);
  }, [dataAirportSummaries]);

  const primaryAirport = airportCards.find((airport) => !airport.comingSoon) ?? null;
  const firstSharedListing = liveListings.find((listing) => listing.isSharedStay) ?? null;
  const sharedAirportName = firstSharedListing
    ? AIRPORT_LABELS[firstSharedListing.airportCode] ?? firstSharedListing.airportCode
    : null;

  const featureStrip = [
    { title: "Airport-first search", icon: AirportPinIcon },
    // SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md
    { title: SHARED_STAYS_ENABLED ? "Flexible and shared stays" : "Flexible stays", icon: CalendarRangeIcon },
    { title: "Transparent pricing", icon: CardCheckIcon },
    { title: "Secure payments via Stripe", icon: CardIcon },
  ];

  return (
    <main className={cx(inter.className, "min-h-screen bg-[#f6f8fb] text-slate-950")}>
      <section className="relative z-10 border-b border-slate-200/80 bg-slate-950">
        <div className="relative isolate min-h-[720px] bg-slate-950 lg:min-h-[760px]">
            <Image
              src="/images/hero/hero-airport-room.webp"
              alt="Professional arriving at an airport hotel room at sunset"
              fill
              priority
              sizes="100vw"
              className="object-cover object-[58%_18%]"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.84)_0%,rgba(2,6,23,0.64)_34%,rgba(2,6,23,0.28)_63%,rgba(2,6,23,0.12)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-slate-950/65 to-transparent" />

            <div className="relative mx-auto grid min-h-[720px] max-w-7xl content-center gap-10 px-6 py-16 sm:px-8 lg:min-h-[760px] lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,470px)] lg:gap-12 lg:px-8 lg:py-20 xl:px-10">
              <div className="max-w-[36rem] lg:pt-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-slate-950/35 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-[#FEDD02]" />
                  For aviation professionals
                </div>

                <h1
                  className={cx(
                    inter.className,
                    "mt-6 max-w-[11.5ch] text-[3rem] font-semibold leading-[0.98] tracking-[-0.05em] text-white sm:text-[4rem] lg:text-[3.75rem] xl:text-[4.8rem]"
                  )}
                >
                  Professional stays, minutes from the airport.
                </h1>

                <p className="mt-6 max-w-xl text-base leading-7 text-white sm:text-lg">
                  Quiet, reliable accommodation near terminals and transport links - designed
                  around real schedules, not the typical tourist trip.
                </p>

                <p className="mt-8 text-base text-white/80">
                  Hosting near an airport?{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/host/create-listing")}
                    className="rounded-sm bg-transparent p-0 font-semibold text-white underline underline-offset-4 transition hover:bg-transparent hover:text-[#FEDD02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    Become a host <span aria-hidden>→</span>
                  </button>
                </p>
              </div>

              <div className="lg:self-center">
                <div className="relative z-20 rounded-[26px] border border-white/30 bg-slate-950/58 p-4 shadow-[0_28px_60px_rgba(2,6,23,0.38)] backdrop-blur-md">
                  <div className="mb-4 flex items-center justify-between gap-3 px-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">
                      {previewListings.length > 0 ? "Nearby stays" : "Find a stay"}
                    </p>
                    {isPreviewMode ? (
                      <span
                        className={cx(jetBrainsMono.className, "text-xs leading-4 text-white/55")}
                      >
                        sample data
                      </span>
                    ) : null}
                  </div>

                  <SearchBar align="left" variant="console" onSearch={() => undefined} />

                  <div className="mt-4 rounded-[18px] bg-[rgba(255,255,255,0.04)]">
                    {loadingListings && !isPreviewMode ? (
                      <div className="space-y-3 p-4">
                        {[0, 1, 2].map((item) => (
                          <div
                            key={item}
                            className="h-[76px] animate-pulse rounded-[14px] bg-white/10"
                          />
                        ))}
                      </div>
                    ) : previewListings.length > 0 ? (
                      <div className="space-y-2 p-2">
                        {previewListings.map((listing) => {
                          const metaLine = [
                            listing.travelMinutes != null
                              ? `${listing.travelMinutes} min to terminal`
                              : null,
                            listing.isSharedStay
                              ? "shared"
                              : listing.bookingUnit === "hourly"
                              ? "day-use"
                              : "overnight",
                          ]
                            .filter(Boolean)
                            .join(" · ");

                          return (
                            <button
                              key={listing.id}
                              type="button"
                              onClick={() => {
                                if (!isPreviewMode) router.push(`/listing/${listing.id}`);
                              }}
                              className={cx(
                                "flex w-full items-center gap-4 rounded-[14px] border-[0.5px] border-white/10 bg-[rgba(255,255,255,0.10)] px-4 py-3 text-left backdrop-blur-md transition hover:bg-[rgba(255,255,255,0.16)]",
                                isPreviewMode && "cursor-default"
                              )}
                            >
                              <span
                                className={cx(
                                  jetBrainsMono.className,
                                  "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[#FEDD02] text-[1rem] font-semibold tracking-[-0.04em] text-slate-950"
                                )}
                              >
                                {listing.airportCode}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold text-white">
                                  {listing.title}
                                </span>
                                <span className="mt-1 block truncate text-sm text-white/60">
                                  {metaLine}
                                </span>
                              </span>
                              <span
                                className={cx(
                                  jetBrainsMono.className,
                                  "shrink-0 text-[13px] font-semibold tracking-[-0.03em] text-white"
                                )}
                              >
                                {listing.priceLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2 p-2">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              listingSearchHref(
                                LAUNCH_AIRPORT_CODE,
                                AIRPORT_LABELS[LAUNCH_AIRPORT_CODE] ?? LAUNCH_AIRPORT_CODE
                              )
                            )
                          }
                          className="flex w-full items-center gap-4 rounded-[14px] border-[0.5px] border-white/10 bg-[rgba(255,255,255,0.10)] px-4 py-3 text-left backdrop-blur-md transition hover:bg-[rgba(255,255,255,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                        >
                          <span
                            className={cx(
                              jetBrainsMono.className,
                              "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[#FEDD02] text-[1rem] font-semibold tracking-[-0.04em] text-slate-950"
                            )}
                          >
                            {LAUNCH_AIRPORT_CODE}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold text-white">
                              {AIRPORT_LABELS[LAUNCH_AIRPORT_CODE]}
                            </span>
                            <span className="mt-1 block truncate text-sm text-white/60">
                              Launch airport · Search availability
                            </span>
                          </span>
                          <span aria-hidden className="shrink-0 text-lg text-white/60">
                            →
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
      </section>

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-4 py-6 md:grid-cols-4">
            {featureStrip.map((item) => (
              <li
                key={item.title}
                className="flex items-center gap-2.5 text-[15px] font-medium text-slate-800 md:justify-center"
              >
                <item.icon className="h-[22px] w-[22px] shrink-0 text-slate-900" />
                {item.title}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <SectionHeader
            eyebrow="Airports"
            title="Stay close to where you operate."
            body="We're launching at London Stansted, with more airports to follow."
            action={
              <Link
                href="/search"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 underline-offset-4 hover:text-slate-950 hover:underline"
              >
                Search all stays <span aria-hidden>→</span>
              </Link>
            }
          />

          <div className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {airportCards.map((airport) =>
              airport.comingSoon ? (
                <div
                  key={airport.code}
                  aria-disabled="true"
                  className="flex min-h-[230px] flex-col justify-between rounded-[28px] border border-dashed border-slate-300 bg-[#f7f8fa] p-6"
                >
                  <span
                    className={cx(
                      jetBrainsMono.className,
                      "text-5xl font-semibold tracking-[-0.05em] text-slate-300"
                    )}
                  >
                    {airport.code}
                  </span>
                  <div>
                    <h3 className={cx(inter.className, "text-lg font-semibold tracking-[-0.02em] text-slate-500")}>
                      {airport.name}
                    </h3>
                    <span className="mt-3 inline-flex rounded-full bg-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-500">
                      Coming soon
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  key={airport.code}
                  type="button"
                  onClick={() => router.push(listingSearchHref(airport.code, airport.name))}
                  className="group flex min-h-[230px] flex-col justify-between rounded-[28px] bg-slate-950 p-6 text-left text-white transition duration-300 hover:-translate-y-0.5 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={cx(
                        jetBrainsMono.className,
                        "text-5xl font-semibold tracking-[-0.05em] text-[#FEDD02]"
                      )}
                    >
                      {airport.code}
                    </span>
                    <span
                      aria-hidden
                      className="text-xl text-white/60 transition group-hover:text-white"
                    >
                      ↗
                    </span>
                  </div>
                  <div>
                    <h3 className={cx(inter.className, "text-lg font-semibold tracking-[-0.02em] text-white")}>
                      {airport.name}
                    </h3>
                    <p className="mt-1.5 text-sm font-medium text-white/80">
                      {airport.listingCount > 0
                        ? `${airport.listingCount} stay${airport.listingCount === 1 ? "" : "s"}`
                        : "Launch airport"}
                    </p>
                    <p className="mt-0.5 text-sm text-white/55">
                      {airport.averageMinutes != null
                        ? `Avg. commute ${airport.averageMinutes} min`
                        : airport.listingCount > 0
                        ? "Travel time on each listing"
                        : "Search availability"}
                    </p>
                  </div>
                </button>
              )
            )}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative isolate scroll-mt-16 overflow-hidden bg-slate-950">
        <Image
          src="/images/how-it-works/crew-departure.webp"
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          quality={70}
          className="-z-20 object-cover object-center"
        />
        {/* the dark filter: heavier on the left behind the heading, lighter on the right so the image shows */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(2,6,23,0.92)_0%,rgba(2,6,23,0.78)_50%,rgba(2,6,23,0.62)_100%)]"
        />
        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <SectionHeader dark eyebrow="How it works" title="Simple, built for real schedules." />

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Pick your airport",
                body: "Search by airport and see commute time before you commit.",
                visual: (
                  <div className="w-full max-w-[17rem] divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-left shadow-[0_14px_34px_rgba(0,0,0,0.35)]">
                    <div className="px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Airport
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-slate-950">
                        London Stansted (STN)
                      </p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Dates
                      </p>
                      <p className="mt-0.5 text-sm text-slate-500">Add dates</p>
                    </div>
                  </div>
                ),
              },
              {
                step: "02",
                title: "Choose how you stay",
                // SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md
                body: SHARED_STAYS_ENABLED
                  ? "Overnight, flexible or shared, with the price shown up front."
                  : "Overnight or flexible, with the price shown up front.",
                visual: (
                  <div className="inline-flex rounded-full bg-white/10 p-1 text-sm font-medium ring-1 ring-white/10">
                    <span className="rounded-full bg-white px-4 py-2 text-slate-950">Overnight</span>
                    <span className="px-4 py-2 text-white/70">Flexible</span>
                    {/* SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md */}
                    {SHARED_STAYS_ENABLED ? (
                      <span className="px-4 py-2 text-white/70">Shared</span>
                    ) : null}
                  </div>
                ),
              },
              {
                step: "03",
                title: "Book securely",
                body: "Secure checkout with Stripe. Confirmation follows payment.",
                visual: (
                  <div className="w-full max-w-[17rem] text-center">
                    <span className="block rounded-xl bg-[#FEDD02] px-5 py-3 text-sm font-semibold text-black shadow-[0_14px_34px_rgba(254,221,2,0.22)]">
                      Book this stay
                    </span>
                    <p className="mt-3 text-balance text-xs text-white/60">
                      Secure checkout — confirmed once payment completes.
                    </p>
                  </div>
                ),
              },
            ].map((item) => (
              <article
                key={item.step}
                className="flex flex-col overflow-hidden rounded-[28px] bg-slate-950/55 ring-1 ring-white/10 backdrop-blur-md"
              >
                <div
                  aria-hidden
                  className="flex h-44 items-center justify-center bg-gradient-to-b from-white/[0.07] to-transparent px-6 sm:h-52"
                >
                  {item.visual}
                </div>
                <div className="p-7 pt-6">
                  <span
                    className={cx(
                      jetBrainsMono.className,
                      "text-xs font-semibold tracking-[0.08em] text-white/50"
                    )}
                  >
                    {item.step}
                  </span>
                  <h3
                    className={cx(
                      inter.className,
                      "mt-3 text-xl font-semibold tracking-[-0.03em] text-white"
                    )}
                  >
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-6 text-white/65">{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <SectionHeader
            eyebrow="Stay formats"
            title="Built for rosters that change."
            // SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md
            body={
              SHARED_STAYS_ENABLED
                ? "Book the way your schedule works: a fixed stay, room to extend, or a shared stay to split the cost."
                : "Book the way your schedule works: a fixed stay, or room to extend if plans change."
            }
          />

          {/* SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md: with the Shared card hidden, the Flexible card is full-width and horizontal on desktop. */}
          <div className={cx("mt-12 grid gap-5", SHARED_STAYS_ENABLED && "lg:grid-cols-2")}>
            <article
              className={cx(
                "flex flex-col overflow-hidden rounded-[32px] bg-gradient-to-b from-[#f8f9fb] to-[#eef0f4] ring-1 ring-slate-200/70",
                !SHARED_STAYS_ENABLED && "lg:grid lg:grid-cols-2"
              )}
            >
              <div
                className={cx(
                  "relative aspect-[16/9] w-full",
                  !SHARED_STAYS_ENABLED && "lg:aspect-auto lg:h-full lg:min-h-[400px]"
                )}
              >
                <Image
                  src="/images/formats/flexible-stay.webp"
                  alt="Illustration of a bedroom with a suitcase and a calendar by the bed, with an airport visible through the window"
                  fill
                  sizes="(min-width: 1024px) 600px, 100vw"
                  className="object-cover"
                />
              </div>
              <div
                className={cx(
                  "flex flex-1 flex-col p-8 lg:p-10",
                  !SHARED_STAYS_ENABLED && "lg:justify-center lg:p-14"
                )}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8a6a00]">
                  Flexible stays
                </p>
                <h3
                  className={cx(
                    inter.className,
                    "mt-4 text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.04em] text-slate-950 lg:text-4xl"
                  )}
                >
                  Book what you know.
                  <br />
                  Extend if plans change.
                </h3>
                <p className="mt-4 text-pretty text-base leading-7 text-slate-600">
                  Where a host offers flexibility, you can add an extra night or extend without
                  rebooking as your roster moves. You&apos;re only charged if you extend.
                </p>
                <div className={cx("pt-8", SHARED_STAYS_ENABLED ? "mt-auto" : "lg:pt-10")}>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        primaryAirport
                          ? listingSearchHref(primaryAirport.code, primaryAirport.name)
                          : "/search"
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-sm bg-transparent p-0 text-sm font-semibold text-slate-950 underline-offset-4 hover:bg-transparent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                  >
                    Explore stays <span aria-hidden>→</span>
                  </button>
                </div>
              </div>
            </article>

            {/* SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md */}
            {SHARED_STAYS_ENABLED ? (
            <article className="flex flex-col overflow-hidden rounded-[32px] bg-slate-950 text-white ring-1 ring-white/10">
              <div className="relative aspect-[16/9] w-full">
                <Image
                  src="/images/formats/shared-stay.webp"
                  alt="Illustration of a shared apartment with two suitcases and two coffee cups, with an airport visible through the window"
                  fill
                  sizes="(min-width: 1024px) 600px, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col p-8 lg:p-10">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#FEDD02]">
                  Shared stays
                </p>
                <h3
                  className={cx(
                    inter.className,
                    "mt-4 text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.04em] text-white lg:text-4xl"
                  )}
                >
                  Share the stay.
                  <br />
                  Split the cost.
                </h3>
                <p className="mt-4 text-pretty text-base leading-7 text-white/70">
                  Shared stays let professionals split the weekly cost near the same airport. Each
                  guest books and pays individually.
                  {firstSharedListing && sharedAirportName
                    ? ` Live now near ${sharedAirportName}.`
                    : ""}
                </p>
                <div className="mt-auto pt-8">
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        firstSharedListing && sharedAirportName
                          ? listingSearchHref(firstSharedListing.airportCode, sharedAirportName, {
                              shared_stays: "true",
                            })
                          : "/search"
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-sm bg-transparent p-0 text-sm font-semibold text-white underline-offset-4 hover:bg-transparent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    View shared stays <span aria-hidden>→</span>
                  </button>
                </div>
              </div>
            </article>
            ) : null}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 pb-20 lg:px-8 lg:pb-28">
          <div className="relative overflow-hidden rounded-[32px] bg-[#FEDD02] px-8 pt-12 text-slate-950 md:px-14 md:py-16">
            <div className="relative z-10 max-w-xl xl:max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-900/70">
                For hosts
              </p>
              <h2
                className={cx(
                  inter.className,
                  "mt-4 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] text-slate-950 sm:text-5xl"
                )}
              >
                List your property near an airport.
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-900/75">
                Attract professional guests, set clear booking rules, and make your listing easy
                to compare inside the same airport-first search flow.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
                <button
                  type="button"
                  onClick={() => router.push("/host/create-listing")}
                  className="rounded-full bg-slate-950 px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FEDD02]"
                >
                  Become a host
                </button>
                <p className="text-sm text-slate-900/70">It&apos;s free to get started.</p>
              </div>
            </div>

            <div
              aria-hidden
              className="pointer-events-none relative mt-8 h-56 select-none md:absolute md:bottom-[-25%] md:right-6 md:top-0 md:mt-0 md:h-auto md:w-[38%] lg:right-12"
            >
              <Image
                src="/images/hosts/control-tower.webp"
                alt=""
                fill
                sizes="(min-width: 768px) 380px, 300px"
                className="object-contain object-right-bottom"
              />
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-[#09111f] text-slate-200">
        <div className="mx-auto max-w-7xl px-6 py-14 lg:px-8 lg:py-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="max-w-md">
              <Image
                src="/Flexivo%20v4.svg"
                alt="Flexivo"
                width={141}
                height={37}
                className="-mb-[25px] -ml-[23px] -mt-[38px] brightness-0 invert"
                style={{ width: "141px", height: "auto" }}
              />
              <p className="mt-5 text-sm leading-7 text-slate-400">
                Flexivo brings airport-area search, clear pricing, and professional accommodation
                together in one booking flow.
              </p>
            </div>

            <div className="grid gap-8 sm:grid-cols-3">
              {[
                {
                  title: "Product",
                  links: [
                    { label: "Search stays", href: "/search" },
                    // SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md
                    ...(SHARED_STAYS_ENABLED
                      ? [{ label: "Shared stays", href: "/search?shared_stays=true" }]
                      : []),
                  ],
                },
                {
                  title: "Hosts",
                  links: [
                    { label: "Become a host", href: "/host/create-listing" },
                    { label: "Host dashboard", href: "/host/dashboard" },
                    { label: "Payouts", href: "/host/payouts" },
                  ],
                },
                {
                  title: "Support",
                  links: [
                    { label: "Contact support", href: `mailto:${SUPPORT_EMAIL}` },
                    { label: "Log in", href: "/login" },
                  ],
                },
              ].map((group) => (
                <div key={group.title}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {group.title}
                  </p>
                  <ul className="mt-4 space-y-3">
                    {group.links.map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          className="text-sm text-slate-300 transition hover:text-white"
                        >
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-slate-500">
            <span>© 2026 Flexivo. All rights reserved.</span>
            <span>United Kingdom</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
