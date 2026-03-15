"use client";

import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import { formatReviewLabel } from "@/lib/reviews";
import { computeAllInPricing, computeGuestTotalMajorFromHostNet } from "@/lib/pricing";

type StaySummary = { units: number; unitLabel: "night" | "hour" } | null;

type MapListing = {
  id: string;
  title?: string;
  description?: string | null;
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
  if (lower.includes("shared")) return "Private room";
  return value.replace(/_/g, " ");
};

const safeMinutes = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const formatMinutesRange = (min: number | null, max?: number | null) => {
  if (!min) return null;
  if (max && max > min) return `${min}–${max} min`;
  return `${min} min`;
};

const pluralize = (value: number, label: string) =>
  `${value} ${label}${value === 1 ? "" : "s"}`;

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

const buildTag = (listing: MapListing) => {
  if (listing.quietForRest) return "Quiet for rest";
  if (listing.blackoutBlinds) return "Blackout blinds";
  if (listing.access24_7) return "24/7 access";
  return "Crew-ready";
};

const buildSummary = (listing: MapListing, transportText: string | null) => {
  const raw = typeof listing.description === "string" ? listing.description.trim() : "";
  if (raw) return raw;
  const airport = listing.airportCode ? `near ${listing.airportCode}` : "near the airport";
  const transport = transportText ? transportText.toLowerCase() : "fast transfer links";
  return `Crew-ready stay ${airport} with ${transport}. Ideal for overnight rotations and reliable rest between shifts.`;
};

const buildTitle = (listing: MapListing) => {
  const bedCount = listing.beds ?? listing.bedrooms ?? null;
  const propertyType = normaliseType(listing.type);
  if (bedCount && propertyType) return `${bedCount} Bed ${propertyType}`;
  return listing.title || propertyType || "Listing";
};

const buildFacts = (listing: MapListing) => {
  const parts = [
    listing.bedrooms ? pluralize(listing.bedrooms, "Bedroom") : null,
    listing.bathrooms ? pluralize(listing.bathrooms, "Bathroom") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

const getTransportInfo = (listing: MapListing) => {
  const travelMode = listing.travelMode ? String(listing.travelMode).toLowerCase() : "";
  const isPublic =
    travelMode.includes("public") || travelMode.includes("transit") || travelMode.includes("bus");
  const fallbackMin = safeMinutes(listing.travelMinutesMin);
  const fallbackMax = safeMinutes(listing.travelMinutesMax);

  const publicMin = safeMinutes(listing.publicTransportMin) ?? (isPublic ? fallbackMin : null);
  const publicMax = safeMinutes(listing.publicTransportMax) ?? (isPublic ? fallbackMax : null);

  const driveMin = safeMinutes(listing.driveMinutesToAirport) ?? (!isPublic ? fallbackMin : null);
  const driveMax =
    listing.driveMinutesToAirport != null ? null : (!isPublic ? fallbackMax : null);

  let usePublic = false;
  if (publicMin != null && driveMin != null) {
    usePublic = publicMin <= driveMin + 5;
  } else if (publicMin != null) {
    usePublic = true;
  }

  if (usePublic && publicMin != null) {
    return {
      mode: "Public transport",
      minutes: formatMinutesRange(publicMin, publicMax),
    };
  }

  if (driveMin != null) {
    return {
      mode: "Drive",
      minutes: formatMinutesRange(driveMin, driveMax),
    };
  }

  return null;
};

const BusIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      d="M6 4h12a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3v1h-2v-1H9v1H7v-1a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm1 3v4h10V7H7zm0 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
      fill="currentColor"
    />
  </svg>
);

const CarIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      d="M5 11h14l-1.6-4.2A2 2 0 0 0 15.54 5H8.46A2 2 0 0 0 6.6 6.8L5 11zm1 7a1 1 0 0 1-1-1v-2h14v2a1 1 0 0 1-1 1h-1v1h-2v-1H9v1H7v-1H6z"
      fill="currentColor"
    />
  </svg>
);

export default function MapListingCardV2({
  listing,
  staySummary,
  active = false,
  onHover,
  onLeave,
  onSelect,
}: MapListingCardProps) {
  const bookingUnit = listing.booking_unit === "hourly" ? "hourly" : "nightly";
  const unitLabel = bookingUnit === "hourly" ? "hour" : "night";
  const hostBasePrice =
    bookingUnit === "hourly"
      ? toNumber(listing.pricePerHour) ?? toNumber(listing.price)
      : toNumber(listing.pricePerNight) ?? toNumber(listing.price);
  const guestUnitPrice =
    hostBasePrice != null
      ? computeGuestTotalMajorFromHostNet(hostBasePrice, {
          nights: 1,
          isFirstCompletedBooking: false,
        })
      : null;
  const stayUnits = staySummary?.units ?? 0;
  const stayTotal =
    hostBasePrice != null && stayUnits > 0
      ? computeAllInPricing({
          hostNetTotalPence: Math.round(hostBasePrice * stayUnits * 100),
          nights: bookingUnit === "hourly" ? 1 : stayUnits,
          isFirstCompletedBooking: false,
        }).guest_total_pence / 100
      : null;
  const showStayTotal = stayTotal != null;

  const tag = buildTag(listing);
  const typeLabel = normaliseType(listing.type);

  const titleLine = buildTitle(listing);
  const factsLine = buildFacts(listing);
  const imageSrc = pickImage(listing);
  const badgeText = listing.isSharedBookingAllowed ? "SHARED BOOKING" : "OVERNIGHT";

  const reviewOverall = toNumber(listing.review_overall ?? listing.reviewOverall);
  const reviewTotal = toNumber(listing.review_total ?? listing.reviewTotal);
  const reviewLabel = reviewOverall != null ? formatReviewLabel(reviewOverall) : null;

  const transportInfo = getTransportInfo(listing);
  const transportMinutes = transportInfo?.minutes;
  const transportText = transportMinutes
    ? `${transportInfo.mode} · ${transportMinutes} to ${listing.airportCode ?? "airport"}`
    : null;
  const summaryText = buildSummary(listing, transportText);
  const locationText = listing.coordsMissing
    ? listing.locationFallback ?? listing.location ?? ""
    : listing.location ?? listing.locationFallback ?? "";
  const showStayTotalDetails = showStayTotal && stayTotal != null;
  const unitLine =
    guestUnitPrice != null
      ? `${formatCurrency(guestUnitPrice)} per ${unitLabel}`
      : null;

  return (
    <Link
      href={listing.id ? `/listing/${listing.id}` : "#"}
      className="block no-underline hover:no-underline"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={() => onSelect?.()}
    >
      <article
        className={`grid min-h-[190px] grid-cols-[42%_1fr] gap-4 rounded-[24px] border border-neutral-200 bg-white p-3 shadow-sm transition duration-200 hover:-translate-y-[1px] hover:shadow-md sm:grid-cols-[220px_1fr] md:min-h-[210px] md:p-4 lg:grid-cols-[240px_1fr_190px] ${
          active ? "border-neutral-400 shadow-md" : ""
        }`}
      >
        <div className="relative h-full w-full overflow-hidden rounded-2xl bg-neutral-100">
          <Image
            src={imageSrc}
            alt={listing.title ?? "Listing image"}
            fill
            className="object-cover"
            sizes="(min-width: 1024px) 240px, (min-width: 640px) 220px, 42vw"
          />
          <span className="absolute bottom-3 left-3 rounded-full bg-black px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#FEDD02]">
            {badgeText}
          </span>
          <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-base text-neutral-700 shadow-sm">
            ♡
          </span>
        </div>

        <div className="flex h-full flex-col gap-2 md:gap-2.5">
          <div>
            <h3 className="text-xl font-semibold leading-tight text-neutral-900 underline underline-offset-2">
              {titleLine}
            </h3>
            {locationText && <div className="mt-1 text-sm text-neutral-600">{locationText}</div>}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
            {listing.airportCode && (
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 font-semibold">
                {listing.airportCode}
              </span>
            )}
            {typeLabel && (
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1">
                {typeLabel}
              </span>
            )}
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
              {tag}
            </span>
            {factsLine && <span>{factsLine}</span>}
          </div>

          <p className="line-clamp-3 text-sm leading-5 text-neutral-700">{summaryText}</p>

          <div className="space-y-1 text-sm">
            {listing.freeCancellation && <div className="font-medium text-emerald-700">Fully refundable</div>}
            <div className="text-neutral-600">All fees included in shown price</div>
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-600">
            {transportText && (
              <span className="inline-flex items-center gap-1.5">
                {transportInfo?.mode === "Public transport" ? <BusIcon /> : <CarIcon />}
                {transportText}
              </span>
            )}
            {reviewOverall != null && reviewTotal != null && reviewTotal > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="font-semibold text-neutral-900">{reviewOverall.toFixed(1)}</span>
                <span>· {reviewLabel ?? "Rated stay"}</span>
                <span>· {reviewTotal} reviews</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-end text-right lg:border-l lg:border-neutral-100 lg:pl-4">
          {guestUnitPrice != null && (
            <>
              <div className="text-3xl font-semibold tracking-tight text-neutral-900">
                {showStayTotalDetails ? formatCurrency(stayTotal) : formatCurrency(guestUnitPrice)}
              </div>
              {showStayTotalDetails ? (
                <>
                  <div className="text-sm text-neutral-600">
                    for {stayUnits} {unitLabel}
                    {stayUnits === 1 ? "" : "s"}
                  </div>
                  {unitLine && <div className="text-sm text-neutral-600">{unitLine}</div>}
                </>
              ) : (
                <div className="text-sm text-neutral-600">per {unitLabel}</div>
              )}
              <div className="mt-1 text-xs text-neutral-500">includes taxes & fees</div>
            </>
          )}
          {guestUnitPrice == null && (
            <div className="text-sm text-neutral-500">Price unavailable</div>
          )}
        </div>

      </article>
    </Link>
  );
}
