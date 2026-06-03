"use client";

import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import { formatReviewSummaryLineFromScore } from "@/lib/reviews";
import { computeGuestStayPricing, computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";

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
  bedrooms?: number | null;
  bathrooms?: number | null;
  distanceKmToAirport?: number | null;
  freeCancellation?: boolean | null;
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
  isSharedStay?: boolean | null;
  sharedTotalSpots?: number | null;
  sharedWeeklyPricePence?: number | null;
  sharedSpotsRemaining?: number | null;
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

const formatCurrency = (value: number) => {
  const isWhole = Math.round(value * 100) % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  }).format(value);
};

const normaliseType = (value?: string) => {
  if (!value) return null;
  const lower = value.replace(/_/g, " ").toLowerCase();
  if (lower.includes("entire")) return "Entire place";
  if (lower.includes("private")) return "Private room";
  if (lower.includes("shared")) return "Private room";
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
  if (typeof listing.title === "string" && listing.title.trim().length > 0) return listing.title;
  const beds = listing.beds ?? listing.bedrooms ?? null;
  const bedLabel = beds ? `${beds} Bed` : null;
  const room = normaliseType(listing.type);
  if ((listing.isSharedStay ?? (listing as any).is_shared_stay) === true) {
    return listing.airportCode ? `Shared stay near ${listing.airportCode}` : "Shared stay near the airport";
  }
  const combined = [bedLabel, room].filter(Boolean).join(" ");
  if (combined) return combined;
  return listing.airportCode ? `Crew house near ${listing.airportCode}` : "Professional stay near the airport";
};

const buildSubline = (listing: MapListing) => {
  const isSharedStay = Boolean(listing.isSharedStay ?? (listing as any).is_shared_stay);
  if (isSharedStay) {
    const spotsRemaining =
      toNumber(listing.sharedSpotsRemaining) ?? toNumber((listing as any).shared_spots_remaining);
    if (spotsRemaining != null && spotsRemaining > 0) {
      return "Join other professionals already staying nearby.";
    }
    return "Professional weekly stay near the airport.";
  }
  return "Reliable base for training blocks and rotations.";
};

const pluralize = (value: number, label: string) =>
  `${value} ${label}${value === 1 ? "" : "s"}`;

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
  const isSharedStay = Boolean(listing.isSharedStay ?? (listing as any).is_shared_stay);
  const unitLabel = isSharedStay ? "week" : bookingUnit === "hourly" ? "hour" : "night";
  const sharedTotalSpotsValue =
    toNumber(listing.sharedTotalSpots) ?? toNumber((listing as any).shared_total_spots) ?? 1;
  const sharedSpotDivisor = Math.max(1, Math.round(Number(sharedTotalSpotsValue)) || 1);
  const sharedWeeklyPricePenceValue =
    toNumber(listing.sharedWeeklyPricePence) ??
    toNumber((listing as any).shared_weekly_price_pence);
  const sharedWeeklyPriceMajor =
    sharedWeeklyPricePenceValue != null
      ? computeSharedPerPersonWeeklyPricePence({
          totalWeeklyPricePence: Number(sharedWeeklyPricePenceValue),
          totalSpots: sharedSpotDivisor,
        }).rounded_per_person_weekly_pence / 100
      : null;
  const hostBasePrice =
    isSharedStay
      ? sharedWeeklyPriceMajor
      : bookingUnit === "hourly"
      ? toNumber(listing.pricePerHour) ?? toNumber(listing.price)
      : toNumber(listing.pricePerNight) ?? toNumber(listing.price);

  const stayUnits = staySummary?.units ?? 0;
  const resolvedUnits = stayUnits > 0 ? stayUnits : 1;
  const stayPricing =
    hostBasePrice != null && !isSharedStay
      ? computeGuestStayPricing({
          hostNetUnitMajor: hostBasePrice,
          units: resolvedUnits,
          bookingUnit,
          isFirstCompletedBooking: false,
        })
      : null;
  const guestUnitPrice = isSharedStay ? sharedWeeklyPriceMajor : stayPricing?.guest_unit_avg_major ?? null;

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
  const stayBadge = isSharedStay ? "Shared stay" : bookingUnit === "hourly" ? "Day-use" : "Overnight";
  const metadataLine = [
    travelBadge,
    normaliseType(listing.type),
    isSharedStay
      ? listing.sharedTotalSpots
        ? pluralize(Math.max(1, Math.round(Number(listing.sharedTotalSpots))), "spot")
        : null
      : listing.beds
      ? pluralize(Math.max(1, Math.round(Number(listing.beds))), "bed")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const ctaLabel = isSharedStay ? "Join shared stay →" : "View stay →";
  const priceDetail = isSharedStay ? "per person / week" : `per ${unitLabel}`;
  const secondaryPriceLine = isSharedStay
    ? (() => {
        const remaining =
          toNumber(listing.sharedSpotsRemaining) ?? toNumber((listing as any).shared_spots_remaining);
        if (remaining == null) return "Weekly shared stay";
        if (remaining <= 0) return "Full";
        return `${Math.round(remaining)} spot${Math.round(remaining) === 1 ? "" : "s"} remaining`;
      })()
    : "All fees included";
  const reviewOverall = toNumber(listing.review_overall ?? listing.reviewOverall);
  const reviewTotal = toNumber(listing.review_total ?? listing.reviewTotal);
  const reviewLine =
    reviewOverall != null && reviewTotal != null && reviewTotal > 0
      ? formatReviewSummaryLineFromScore(reviewOverall, reviewTotal)
      : null;

  return (
    <Link
      href={listingId ? `/listing/${listingId}` : "#"}
      prefetch={false}
      className="no-underline hover:no-underline"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={() => onSelect?.()}
    >
      <article
        className={`grid gap-5 rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:grid-cols-[236px_1fr_170px] ${
          active ? "border-[#0B0D10] shadow-md" : "hover:border-slate-300"
        }`}
      >
        <div className="relative h-[184px] w-full overflow-hidden rounded-2xl bg-slate-100 sm:h-[164px]">
          <Image
            src={imageSrc}
            alt={listing.title ?? "Listing image"}
            fill
            className="object-cover"
            sizes="240px"
          />
          <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            {stayBadge}
          </span>
          {travelBadge && (
            <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {travelBadge}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h3 className="line-clamp-2 text-lg font-semibold text-[#0B0D10] font-display">
              {titleLine}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-[#4B5563]">{subline}</p>
            {metadataLine ? (
              <p className="mt-2 line-clamp-1 text-sm text-neutral-600">{metadataLine}</p>
            ) : null}
            {reviewLine ? (
              <p className="mt-1 text-xs text-[#4B5563] font-mono tabular-nums">
                {reviewLine}
              </p>
            ) : null}
          </div>

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
            </div>
          )}

          <div className="mt-auto pt-1 text-sm font-medium text-neutral-800">{ctaLabel}</div>
        </div>

        <div className="flex flex-col items-start justify-end text-left sm:items-end sm:text-right">
          <div>
            {guestUnitPrice != null && (
              <div className="text-[1.45rem] font-semibold text-[#0B0D10] font-mono tabular-nums">
                {formatCurrency(guestUnitPrice)}
              </div>
            )}
            <div className="text-xs font-medium text-[#4B5563]">{priceDetail}</div>
            <div className="mt-1 text-xs text-slate-500">{secondaryPriceLine}</div>
          </div>
        </div>
      </article>
    </Link>
  );
}
