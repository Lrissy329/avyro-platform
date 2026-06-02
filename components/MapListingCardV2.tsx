"use client";

import Link from "next/link";
import Image from "next/image";
import type { LinkProps } from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatReviewLabel } from "@/lib/reviews";
import { computeGuestStayPricing, computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";
import { SharedStayBadge } from "@/components/shared-stay/SharedStayBadge";

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

const WIDE_LAYOUT_MIN_WIDTH = 820;

export default function MapListingCardV2({
  listing,
  listingHref,
  staySummary,
  active = false,
  onHover,
  onLeave,
  onSelect,
}: MapListingCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [isWideLayout, setIsWideLayout] = useState(false);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;

    const updateLayout = () => {
      setIsWideLayout(node.clientWidth >= WIDE_LAYOUT_MIN_WIDTH);
    };

    updateLayout();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateLayout());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

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

  const tag = buildTag(listing);
  const typeLabel = normaliseType(listing.type);

  const titleLine = buildTitle(listing);
  const factsLine = buildFacts(listing);
  const imageSrc = pickImage(listing);
  const badgeText = isSharedStay ? "SHARED STAY" : "OVERNIGHT";

  const reviewOverall = toNumber(listing.review_overall ?? listing.reviewOverall);
  const reviewTotal = toNumber(listing.review_total ?? listing.reviewTotal);
  const reviewLabel = reviewOverall != null ? formatReviewLabel(reviewOverall) : null;

  const transportInfo = getTransportInfo(listing);
  const transportMinutes = transportInfo?.minutes;
  const transportText = transportMinutes
    ? `${transportInfo.mode} · ${transportMinutes} to ${listing.airportCode ?? "airport"}`
    : null;
  const summaryText = buildSummary(listing, transportText);
  const sharedSummaryText = isSharedStay
    ? "Join a weekly crew group and pay per person. Start a group if one is not open yet."
    : null;
  const locationText = listing.coordsMissing
    ? listing.locationFallback ?? listing.location ?? ""
    : listing.location ?? listing.locationFallback ?? "";
  const showStayTotalDetails = showStayTotal && stayTotal != null;
  const unitLine =
    guestUnitPrice != null
      ? isSharedStay
        ? `${formatCurrency(guestUnitPrice)} per person / week`
        : `${formatCurrency(guestUnitPrice)} avg per ${unitLabel}`
      : null;
  const keyTags = [listing.airportCode, typeLabel, isSharedStay ? "Shared stay" : tag].filter(
    (value): value is string => Boolean(value)
  );
  const visibleTags = isWideLayout ? keyTags.slice(0, 3) : keyTags.slice(0, 2);
  const sharedSpotsRemainingValue =
    toNumber(listing.sharedSpotsRemaining) ??
    toNumber((listing as any).shared_spots_remaining);
  const href = listingHref ?? (listing.id ? `/listing/${listing.id}` : "#");

  const renderPrice = (compact = false) => {
    if (guestUnitPrice == null) {
      return <div className="text-sm text-neutral-500">Price unavailable</div>;
    }

    const priceAmount = showStayTotalDetails && stayTotal != null ? stayTotal : guestUnitPrice;
    const valueClass = compact
      ? "text-2xl font-semibold tracking-tight text-neutral-900"
      : "text-3xl font-semibold tracking-tight text-neutral-900";
    const detailClass = compact ? "text-xs text-neutral-600" : "text-sm text-neutral-600";
    const footnoteClass = compact ? "mt-0.5 text-[11px] text-neutral-500" : "mt-1 text-xs text-neutral-500";

    return (
      <>
        <div className={valueClass}>{formatCurrency(priceAmount)}</div>
        {showStayTotalDetails ? (
          <>
            <div className={detailClass}>
              for {resolvedUnits} {unitLabel}
              {resolvedUnits === 1 ? "" : "s"}
            </div>
            {unitLine && <div className={detailClass}>{unitLine}</div>}
          </>
        ) : (
          <div className={detailClass}>
            {isSharedStay ? "per person / week" : `per ${unitLabel}`}
          </div>
        )}
        <div className={footnoteClass}>
          {isSharedStay
            ? sharedSpotsRemainingValue != null
              ? sharedSpotsRemainingValue <= 0
                ? "Full"
                : `${Math.max(0, Math.round(sharedSpotsRemainingValue))} spot${
                    Math.max(0, Math.round(sharedSpotsRemainingValue)) === 1 ? "" : "s"
                  } left`
              : "Each guest books and pays individually"
            : "includes taxes & fees"}
        </div>
      </>
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
      <article
        ref={cardRef}
        className={`grid items-stretch rounded-[24px] border border-neutral-200 bg-white shadow-sm transition duration-200 hover:-translate-y-[1px] hover:shadow-md ${
          isWideLayout
            ? "min-h-[210px] grid-cols-[180px_minmax(0,1fr)_120px] gap-4 p-4"
            : "min-h-[190px] grid-cols-[150px_minmax(0,1fr)] gap-3 p-3"
        } ${
          active ? "border-neutral-400 shadow-md" : ""
        }`}
      >
        <div
          className={`relative w-full overflow-hidden rounded-2xl bg-neutral-100 ${
            isWideLayout ? "h-[178px]" : "h-full min-h-[164px]"
          }`}
        >
          <Image
            src={imageSrc}
            alt={listing.title ?? "Listing image"}
            fill
            className="object-cover"
            sizes={isWideLayout ? "180px" : "150px"}
          />
          <span className="absolute bottom-3 left-3 rounded-full bg-black px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#FEDD02]">
            {badgeText}
          </span>
          <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-base text-neutral-700 shadow-sm">
            ♡
          </span>
        </div>

        <div className={`flex h-full min-w-0 flex-col ${isWideLayout ? "gap-2.5" : "gap-2"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3
                className={`line-clamp-2 font-semibold leading-tight text-neutral-900 ${
                  isWideLayout ? "text-lg" : "text-base"
                }`}
              >
                {titleLine}
              </h3>
              {locationText && <div className="mt-1 line-clamp-1 text-sm text-neutral-600">{locationText}</div>}
            </div>
            {!isWideLayout ? <div className="shrink-0 text-right">{renderPrice(true)}</div> : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-600">
            {visibleTags.map((tagLabel) => (
              <span
                key={tagLabel}
                className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1"
              >
                {tagLabel}
              </span>
            ))}
          </div>

          <SharedStayBadge
            isSharedStay={isSharedStay}
            perPersonWeeklyPrice={sharedWeeklyPriceMajor}
            spotsRemaining={listing.sharedSpotsRemaining ?? null}
            totalSpots={listing.sharedTotalSpots ?? null}
          />

          <p className="line-clamp-2 text-sm leading-5 text-neutral-700">
            {sharedSummaryText ?? summaryText}
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
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
                <span>({reviewTotal})</span>
              </span>
            )}
            {isWideLayout && factsLine ? <span>{factsLine}</span> : null}
          </div>
        </div>

        {isWideLayout ? (
          <div className="flex flex-col justify-end border-l border-neutral-100 pl-3 text-right">
            {renderPrice(false)}
          </div>
        ) : null}

      </article>
    </Link>
  );
}
