"use client";

import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import { formatReviewSummaryLineFromScore } from "@/lib/reviews";

type StaySummary = { units: number; unitLabel: "night" | "hour" } | null;

type MapListing = {
  id: string;
  title?: string;
  location?: string;
  locationFallback?: string;
  coordsMissing?: boolean;
  airportCode?: string;
  booking_unit?: "nightly" | "hourly" | null;
  pricePerNight?: number;
  pricePerHour?: number;
  price?: number;
  thumbnail?: string;
  imageUrl?: string;
  photos?: string[] | null;
  type?: string;
  beds?: number | null;
  maxGuests?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  distanceKmToAirport?: number | null;
  freeCancellation?: boolean | null;
  isSharedBookingAllowed?: boolean;
  travelMinutesMin?: number | null;
  travelMinutesMax?: number | null;
  travelMode?: string | null;
  driveMinutesToAirport?: number | null;
  quietForRest?: boolean | null;
  blackoutBlinds?: boolean | null;
  access24_7?: boolean | null;
  publicTransportMin?: number | null;
  publicTransportMax?: number | null;
  taxiMin?: number | null;
  taxiMax?: number | null;
  review_overall?: number | null;
  review_total?: number | null;
  reviewOverall?: number | null;
  reviewTotal?: number | null;
};

type MapListingCardProps = {
  listing: MapListing;
  staySummary?: StaySummary;
  active?: boolean;
  onHover?: () => void;
  onLeave?: () => void;
  onSelect?: () => void;
};

const BUCKET = "listing-photos";
const toPublicUrl = (pathOrUrl?: string | null): string | null => {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const key = pathOrUrl.startsWith("/") ? pathOrUrl.slice(1) : pathOrUrl;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data?.publicUrl ?? null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);

const normaliseType = (value?: string) => {
  if (!value) return null;
  const lower = value.replace(/_/g, " ").toLowerCase();
  if (lower.includes("entire")) return "Entire place";
  if (lower.includes("private")) return "Private room";
  if (lower.includes("shared")) return "Shared room";
  return value.replace(/_/g, " ");
};

const formatMinutesRange = (min: number | null, max?: number | null) => {
  if (!min) return null;
  if (max && max > min) return `${min}–${max} min`;
  return `${min} min`;
};

const safeMinutes = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const TaxiIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      d="M5 11h14l-1.6-4.2A2 2 0 0 0 15.54 5H8.46A2 2 0 0 0 6.6 6.8L5 11zm1 7a1 1 0 0 1-1-1v-2h14v2a1 1 0 0 1-1 1h-1v1h-2v-1H9v1H7v-1H6z"
      fill="currentColor"
    />
  </svg>
);

const BusIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      d="M6 4h12a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3v1h-2v-1H9v1H7v-1a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm1 3v4h10V7H7zm0 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
      fill="currentColor"
    />
  </svg>
);

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const pickImage = (listing: MapListing): string => {
  const rawCandidates = [
    listing.imageUrl,
    listing.thumbnail,
    Array.isArray(listing.photos) ? listing.photos[0] : undefined,
  ].filter((src): src is string => typeof src === "string" && src.length > 0);

  for (const src of rawCandidates) {
    const resolved = toPublicUrl(src);
    if (resolved) return resolved;
  }

  return "/placeholder.jpg";
};

const buildTravelBadge = (listing: MapListing) => {
  const min = safeMinutes(listing.travelMinutesMin) ?? safeMinutes(listing.driveMinutesToAirport);
  const label = formatMinutesRange(min, listing.travelMinutesMax ?? null);
  if (!label || !listing.airportCode) return label;
  return `${label} to ${listing.airportCode}`;
};

const buildTitle = (listing: MapListing) => {
  const beds = listing.beds ?? listing.bedrooms ?? null;
  const bedLabel = beds ? `${beds} Bed` : null;
  const room = normaliseType(listing.type);
  const minutes =
    safeMinutes(listing.travelMinutesMin) ?? safeMinutes(listing.driveMinutesToAirport);
  const distanceLabel =
    minutes != null
      ? `${minutes} min from ${listing.airportCode ?? "Airport"}`
      : listing.airportCode
      ? `Near ${listing.airportCode}`
      : null;
  const combined = [bedLabel, room].filter(Boolean).join(" ");
  if (combined && distanceLabel) return `${combined} · ${distanceLabel}`;
  return combined || listing.title || "Listing";
};

const buildSubline = (listing: MapListing) => {
  const room = normaliseType(listing.type);
  let restNote: string | null = null;
  if (listing.quietForRest) restNote = "Quiet for rest";
  else if (listing.blackoutBlinds) restNote = "Blackout blinds";
  else if (listing.access24_7) restNote = "24/7 access";
  if (!restNote) restNote = "Crew-ready";
  const parts = [room, restNote].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

export default function MapListingCard({
  listing,
  staySummary,
  active = false,
  onHover,
  onLeave,
  onSelect,
}: MapListingCardProps) {
  const bookingUnit =
    listing.booking_unit === "hourly" ? "hourly" : "nightly";
  const unitLabel = bookingUnit === "hourly" ? "hour" : "night";
  const basePrice =
    bookingUnit === "hourly"
      ? toNumber(listing.pricePerHour) ?? toNumber(listing.price)
      : toNumber(listing.pricePerNight) ?? toNumber(listing.price);

  const totalPrice =
    staySummary && basePrice ? basePrice * staySummary.units : null;

  const travelBadge = buildTravelBadge(listing);
  const titleLine = buildTitle(listing);
  const subline = buildSubline(listing);

  const travelMode = listing.travelMode ? String(listing.travelMode).toLowerCase() : "";
  const fallbackMin = listing.travelMinutesMin ?? listing.driveMinutesToAirport ?? null;
  const fallbackMax = listing.travelMinutesMax ?? null;
  const taxiRange = formatMinutesRange(
    listing.taxiMin ?? (travelMode && travelMode.includes("public") ? null : fallbackMin),
    listing.taxiMax ?? (travelMode && travelMode.includes("public") ? null : fallbackMax)
  );
  const busRange = formatMinutesRange(
    listing.publicTransportMin ??
      (travelMode.includes("public") || travelMode.includes("transit") || travelMode.includes("bus")
        ? fallbackMin
        : null),
    listing.publicTransportMax ??
      (travelMode.includes("public") || travelMode.includes("transit") || travelMode.includes("bus")
        ? fallbackMax
        : null)
  );
  const imageSrc = pickImage(listing);
  const listingId = listing.id;
  const stayBadge = bookingUnit === "hourly" ? "DAY-USE" : "OVERNIGHT";
  const distanceMiles =
    listing.distanceKmToAirport != null
      ? Math.round(listing.distanceKmToAirport * 0.621371 * 10) / 10
      : null;
  const facts = [
    normaliseType(listing.type),
    listing.maxGuests ? `Sleeps ${listing.maxGuests}` : null,
    listing.bedrooms ? `${listing.bedrooms} Bedroom${listing.bedrooms === 1 ? "" : "s"}` : null,
    listing.bathrooms ? `${listing.bathrooms} Bathroom${listing.bathrooms === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const restMeta = [
    "Crew-ready",
    listing.quietForRest ? "Quiet" : null,
    listing.blackoutBlinds ? "Blackout" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const reviewOverall = toNumber(listing.review_overall ?? listing.reviewOverall);
  const reviewTotal = toNumber(listing.review_total ?? listing.reviewTotal);
  const reviewLine =
    reviewOverall != null && reviewTotal != null && reviewTotal > 0
      ? formatReviewSummaryLineFromScore(reviewOverall, reviewTotal)
      : null;

  return (
    <Link
      href={listingId ? `/listing/${listingId}` : "#"}
      className="no-underline hover:no-underline"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={() => onSelect?.()}
    >
      <article
        className={`grid gap-6 rounded-[28px] border border-slate-300 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:grid-cols-[220px_1fr_190px] ${
          active ? "border-[#0B0D10] shadow-md" : "hover:border-slate-400"
        }`}
      >
        <div className="relative h-[160px] w-full overflow-hidden rounded-2xl bg-slate-100 sm:h-[140px]">
          <Image
            src={imageSrc}
            alt={listing.title ?? "Listing image"}
            fill
            className="object-cover"
            sizes="240px"
          />
          <span className="absolute bottom-2 left-2 rounded-md bg-black px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#FEDD02]">
            {stayBadge}
          </span>
          {distanceMiles != null && (
            <span className="absolute right-2 top-2 rounded-full border border-white/40 bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">
              {distanceMiles} mi
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-900">
            {travelBadge && (
              <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {travelBadge}
              </span>
            )}
            <span className="text-xs font-medium text-slate-500">{restMeta}</span>
            {listing.isSharedBookingAllowed && (
              <span className="rounded-md bg-[#FEDD02] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-black">
                Shared booking
              </span>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold text-[#0B0D10] font-display">
              {titleLine}
            </h3>
            <p className="mt-1 text-sm text-[#4B5563]">{subline}</p>
            {reviewLine ? (
              <p className="mt-1 text-xs text-[#4B5563] font-mono tabular-nums">
                {reviewLine}
              </p>
            ) : null}
          </div>

          {facts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#4B5563]">
              {facts.map((fact, index) => (
                <span key={fact as string}>
                  {index > 0 ? "· " : ""}
                  {fact}
                </span>
              ))}
            </div>
          )}

          {(taxiRange || busRange) && (
            <div className="flex flex-wrap items-center gap-4 text-xs text-[#4B5563]">
              {taxiRange && (
                <span className="inline-flex items-center gap-2">
                  <TaxiIcon />
                  <span>{taxiRange}</span>
                </span>
              )}
              {busRange && (
                <span className="inline-flex items-center gap-2">
                  <BusIcon />
                  <span>{busRange}</span>
                </span>
              )}
              {listing.airportCode && (
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="h-px w-12 border-t border-dashed border-slate-300" />
                  ✈
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end justify-between text-right">
          <div>
            {basePrice != null && (
              <div className="text-xl font-semibold text-[#0B0D10] font-mono tabular-nums">
                {formatCurrency(basePrice)} / {unitLabel}
              </div>
            )}
            <div className="text-xs font-medium text-[#4B5563]">All fees included</div>
            {listing.freeCancellation && (
              <div className="mt-1 text-xs text-slate-500">Free cancellation</div>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
