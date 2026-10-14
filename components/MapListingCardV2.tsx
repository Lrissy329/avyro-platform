"use client";

import Link from "next/link";
import Image from "next/image";
import type { LinkProps } from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { computeGuestStayPricing, computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";

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
  travelTimeApproximate?: boolean | null;
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
  listingHref?: LinkProps["href"];
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

const buildSummary = (listing: MapListing) => {
  const isSharedStay = Boolean(listing.isSharedStay ?? listing.isSharedBookingAllowed);
  if (isSharedStay) {
    const remaining =
      toNumber(listing.sharedSpotsRemaining) ?? toNumber((listing as any).shared_spots_remaining);
    if (remaining != null && remaining > 0) return "Join other professionals already staying nearby.";
    return "Professional weekly stay near the airport.";
  }
  if (listing.booking_unit === "hourly") return "Short-stay room near the airport.";
  const raw = typeof listing.description === "string" ? listing.description.trim() : "";
  if (raw && raw.length <= 120) return raw;
  return "Reliable base for training blocks and rotations.";
};

const buildTitle = (listing: MapListing) => {
  if (typeof listing.title === "string" && listing.title.trim().length > 0) return listing.title;
  const bedCount = listing.beds ?? listing.bedrooms ?? null;
  const propertyType = normaliseType(listing.type);
  if (Boolean(listing.isSharedStay ?? listing.isSharedBookingAllowed)) {
    return listing.airportCode ? `Shared stay near ${listing.airportCode}` : "Shared stay near the airport";
  }
  if (bedCount && propertyType) return `${bedCount} Bed ${propertyType}`;
  if (propertyType) return propertyType;
  return listing.airportCode ? `Crew house near ${listing.airportCode}` : "Professional stay near the airport";
};

const buildFacts = (listing: MapListing) => {
  const parts = [
    listing.beds ? pluralize(listing.beds, "bed") : null,
    listing.bedrooms ? pluralize(listing.bedrooms, "bedroom") : null,
    listing.bathrooms ? pluralize(listing.bathrooms, "bathroom") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

const getTransportInfo = (listing: MapListing) => {
  const travelMode = listing.travelMode ? String(listing.travelMode).toLowerCase() : "";
  const isPublic =
    travelMode.includes("public") || travelMode.includes("transit") || travelMode.includes("bus");
  const fallbackMin =
    listing.travelTimeApproximate ? null : safeMinutes(listing.travelMinutesMin);
  const fallbackMax =
    listing.travelTimeApproximate ? null : safeMinutes(listing.travelMinutesMax);

  const publicMin = safeMinutes(listing.publicTransportMin);
  const publicMax = safeMinutes(listing.publicTransportMax);

  const driveMin =
    safeMinutes(listing.taxiMin) ??
    (listing.travelTimeApproximate
      ? null
      : safeMinutes(listing.driveMinutesToAirport) ?? (!isPublic ? fallbackMin : null));
  const driveMax =
    safeMinutes(listing.taxiMax) ??
    (listing.travelTimeApproximate
      ? null
      : listing.driveMinutesToAirport != null
      ? null
      : !isPublic
      ? fallbackMax
      : null);

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

export default function MapListingCardV2({
  listing,
  listingHref,
  staySummary,
  active = false,
  onHover,
  onLeave,
  onSelect,
}: MapListingCardProps) {
  const bookingUnit = listing.booking_unit === "hourly" ? "hourly" : "nightly";
  const isSharedStay = Boolean(listing.isSharedStay ?? listing.isSharedBookingAllowed);
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
  const resolvedUnits = isSharedStay
    ? stayUnits > 0 && staySummary?.unitLabel === "night"
      ? Math.max(1, Math.ceil(stayUnits / 7))
      : 1
    : stayUnits > 0
    ? stayUnits
    : 1;
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
  const stayTotal = isSharedStay
    ? stayUnits > 0 && staySummary?.unitLabel === "night"
      ? guestUnitPrice != null
        ? guestUnitPrice * resolvedUnits
        : null
      : null
    : stayUnits > 0
    ? stayPricing?.guest_total_major ?? null
    : null;
  const showStayTotal = stayTotal != null;

  const titleLine = buildTitle(listing);
  const factsLine = buildFacts(listing);
  const imageSrc = pickImage(listing);
  const badgeText = isSharedStay ? "Shared stay" : bookingUnit === "hourly" ? "Day-use" : "Overnight";

  const reviewOverall = toNumber(listing.review_overall ?? listing.reviewOverall);
  const reviewTotal = toNumber(listing.review_total ?? listing.reviewTotal);
  const hasReview = reviewOverall != null && reviewTotal != null && reviewTotal > 0;

  const transportInfo = getTransportInfo(listing);
  const transportBadge = transportInfo?.minutes
    ? `${transportInfo.minutes} to ${listing.airportCode ?? "airport"}`
    : listing.travelTimeApproximate && listing.airportCode
    ? `Near ${listing.airportCode}`
    : null;
  const summaryText = buildSummary(listing);
  const locationText = listing.coordsMissing
    ? listing.locationFallback ?? listing.location ?? ""
    : listing.location ?? listing.locationFallback ?? "";
  const showStayTotalDetails = showStayTotal && stayTotal != null;
  const typeLabel = normaliseType(listing.type);
  const metadataLine = [
    typeLabel,
    isSharedStay
      ? listing.sharedTotalSpots
        ? pluralize(Math.max(1, Math.round(Number(listing.sharedTotalSpots))), "spot")
        : null
      : factsLine,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const href = listingHref ?? (listing.id ? `/listing/${listing.id}` : "#");

  const renderPrice = () => {
    if (guestUnitPrice == null) {
      return <div className="text-sm text-neutral-500">Price unavailable</div>;
    }

    const priceAmount = showStayTotalDetails && stayTotal != null ? stayTotal : guestUnitPrice;

    return (
      <div>
        <span className="text-[1.05rem] font-semibold text-neutral-900">
          {formatCurrency(priceAmount)}
        </span>{" "}
        <span className="text-sm text-neutral-600">
          {showStayTotalDetails ? "total" : isSharedStay ? "per person / week" : unitLabel}
        </span>
        {showStayTotalDetails ? (
          <div className="text-xs text-neutral-500">
            for {resolvedUnits} {unitLabel}
            {resolvedUnits === 1 ? "" : "s"}
            {isSharedStay ? " · per person / week" : ""}
          </div>
        ) : null}
        {!isSharedStay ? <div className="text-xs text-neutral-400">includes fees</div> : null}
      </div>
    );
  };

  return (
    <Link
      href={href}
      prefetch={false}
      className="block no-underline hover:no-underline"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={() => onSelect?.()}
    >
      <article className="group">
        <div
          className={`relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-neutral-100 ${
            active ? "ring-2 ring-neutral-900 ring-offset-2" : ""
          }`}
        >
          <Image
            src={imageSrc}
            alt={listing.title ?? "Listing image"}
            fill
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-105"
            sizes="(min-width: 1024px) 480px, 100vw"
          />
          <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            {badgeText}
          </span>
          {transportBadge ? (
            <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {transportBadge}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 pt-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-1 text-[1.02rem] font-semibold leading-snug text-neutral-900">
              {titleLine}
            </h3>
            {hasReview ? (
              <span className="flex shrink-0 items-center gap-1 pt-0.5 text-sm text-neutral-800">
                <span aria-hidden>★</span>
                <span className="font-semibold">{reviewOverall!.toFixed(1)}</span>
              </span>
            ) : null}
          </div>

          {metadataLine ? (
            <div className="line-clamp-1 text-sm text-neutral-500">{metadataLine}</div>
          ) : locationText ? (
            <div className="line-clamp-1 text-sm text-neutral-500">{locationText}</div>
          ) : null}

          <p className="line-clamp-2 text-sm leading-5 text-neutral-600">{summaryText}</p>

          <div className="mt-0.5">{renderPrice()}</div>
        </div>
      </article>
    </Link>
  );
}
