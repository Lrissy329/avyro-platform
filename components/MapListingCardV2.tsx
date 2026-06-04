"use client";

import Link from "next/link";
import Image from "next/image";
import type { LinkProps } from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatReviewLabel } from "@/lib/reviews";
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

const WIDE_LAYOUT_MIN_WIDTH = 820;
const DESKTOP_VIEWPORT_MIN_WIDTH = 1024;

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
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);

  useEffect(() => {
    const node = cardRef.current;

    const mediaQuery =
      typeof window !== "undefined"
        ? window.matchMedia(`(min-width: ${DESKTOP_VIEWPORT_MIN_WIDTH}px)`)
        : null;

    const updateLayout = () => {
      const nextDesktopViewport = Boolean(mediaQuery?.matches);
      setIsDesktopViewport(nextDesktopViewport);
      setIsWideLayout((node?.clientWidth ?? 0) >= WIDE_LAYOUT_MIN_WIDTH);
    };

    updateLayout();

    if (typeof mediaQuery?.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateLayout);
    } else if (typeof mediaQuery?.addListener === "function") {
      mediaQuery.addListener(updateLayout);
    }

    let observer: ResizeObserver | null = null;
    if (node && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => updateLayout());
      observer.observe(node);
    } else if (typeof window !== "undefined") {
      window.addEventListener("resize", updateLayout);
    }

    return () => {
      observer?.disconnect();
      if (typeof mediaQuery?.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", updateLayout);
      } else if (typeof mediaQuery?.removeListener === "function") {
        mediaQuery.removeListener(updateLayout);
      }
      if (!observer && typeof window !== "undefined") {
        window.removeEventListener("resize", updateLayout);
      }
    };
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

  const typeLabel = normaliseType(listing.type);

  const titleLine = buildTitle(listing);
  const factsLine = buildFacts(listing);
  const imageSrc = pickImage(listing);
  const badgeText = isSharedStay ? "Shared stay" : bookingUnit === "hourly" ? "Day-use" : "Overnight";

  const reviewOverall = toNumber(listing.review_overall ?? listing.reviewOverall);
  const reviewTotal = toNumber(listing.review_total ?? listing.reviewTotal);
  const reviewLabel = reviewOverall != null ? formatReviewLabel(reviewOverall) : null;

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
  const metadataLine = [
    transportBadge,
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
  const ctaLabel = isSharedStay ? "Join shared stay →" : "View stay →";
  const useHorizontalLayout = isWideLayout || isDesktopViewport;

  const renderPrice = (compact = false) => {
    if (guestUnitPrice == null) {
      return <div className="text-sm text-neutral-500">Price unavailable</div>;
    }

    const priceAmount = showStayTotalDetails && stayTotal != null ? stayTotal : guestUnitPrice;
    const valueClass = compact
      ? "text-[1.16rem] font-semibold tracking-tight text-neutral-900"
      : "text-[1.45rem] font-semibold tracking-tight text-neutral-900";
    const detailClass = compact ? "text-[11px] text-neutral-500" : "text-xs text-neutral-500";
    const footnoteClass = compact ? "mt-1 text-[11px] text-neutral-400" : "mt-1 text-[11px] text-neutral-400";

    return (
      <>
        <div className={valueClass}>{formatCurrency(priceAmount)}</div>
        {showStayTotalDetails ? (
          <>
            <div className={detailClass}>
              for {resolvedUnits} {unitLabel}
              {resolvedUnits === 1 ? "" : "s"}
            </div>
            {isSharedStay ? <div className={detailClass}>per person / week</div> : null}
          </>
        ) : (
          <div className={detailClass}>
            {isSharedStay ? "per person / week" : `per ${unitLabel}`}
          </div>
        )}
        {!isSharedStay ? <div className={footnoteClass}>includes fees</div> : null}
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
      {!useHorizontalLayout ? (
        <article
          ref={cardRef}
          className={`overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-sm transition duration-200 hover:-translate-y-[1px] hover:shadow-md ${
            active ? "border-neutral-400 shadow-md" : ""
          }`}
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100">
            <Image
              src={imageSrc}
              alt={listing.title ?? "Listing image"}
              fill
              className="object-cover"
              sizes="100vw"
            />
            <span className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {badgeText}
            </span>
          {transportBadge ? (
            <span className="absolute bottom-4 left-4 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                {transportBadge}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 text-[1.05rem] font-semibold leading-6 text-neutral-900">
                  {titleLine}
                </h3>
                {metadataLine ? (
                  <div className="mt-1 line-clamp-1 text-sm text-neutral-600">{metadataLine}</div>
                ) : locationText ? (
                  <div className="mt-1 line-clamp-1 text-sm text-neutral-600">{locationText}</div>
                ) : null}
              </div>
              <div className="shrink-0 text-right">{renderPrice(true)}</div>
            </div>

            <p className="line-clamp-2 text-sm leading-5 text-neutral-700">{summaryText}</p>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="min-w-0 text-xs text-neutral-600">
                {reviewOverall != null && reviewTotal != null && reviewTotal > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="font-semibold text-neutral-900">{reviewOverall.toFixed(1)}</span>
                    <span>· {reviewLabel ?? "Rated stay"}</span>
                    <span>({reviewTotal})</span>
                  </span>
                ) : locationText ? (
                  <span className="line-clamp-1">{locationText}</span>
                ) : null}
              </div>
              <span className="shrink-0 text-sm font-medium text-neutral-800">{ctaLabel}</span>
            </div>
          </div>
        </article>
      ) : (
      <article
        ref={cardRef}
        className={`grid items-stretch rounded-[24px] border border-neutral-200 bg-white shadow-sm transition duration-200 hover:-translate-y-[1px] hover:shadow-md ${
          isWideLayout
            ? "min-h-[182px] grid-cols-[166px_minmax(0,1fr)_118px] gap-4 p-3.5"
            : "min-h-[162px] grid-cols-[152px_minmax(0,1fr)_118px] gap-3.5 p-3.5"
        } ${
          active ? "border-neutral-400 shadow-md" : ""
        }`}
      >
        <div
          className={`relative w-full overflow-hidden rounded-2xl bg-neutral-100 ${
            isWideLayout ? "h-[150px]" : "h-full min-h-[132px]"
          }`}
        >
          <Image
            src={imageSrc}
            alt={listing.title ?? "Listing image"}
            fill
            className="object-cover"
            sizes={isWideLayout ? "164px" : "148px"}
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

        <div className={`flex h-full min-w-0 flex-col ${isWideLayout ? "gap-2.5" : "gap-2"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3
                className={`line-clamp-2 font-semibold leading-tight text-neutral-900 ${
                  isWideLayout ? "text-[1.04rem]" : "text-[1.01rem]"
                }`}
              >
                {titleLine}
              </h3>
              <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-neutral-700">
                {summaryText}
              </p>
              {metadataLine ? (
                <div className="mt-2 line-clamp-1 text-[13px] text-neutral-600">{metadataLine}</div>
              ) : locationText ? (
                <div className="mt-2 line-clamp-1 text-[13px] text-neutral-600">{locationText}</div>
              ) : null}
            </div>
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-neutral-600">
            {reviewOverall != null && reviewTotal != null && reviewTotal > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="font-semibold text-neutral-900">{reviewOverall.toFixed(1)}</span>
                <span>· {reviewLabel ?? "Rated stay"}</span>
                <span>({reviewTotal})</span>
              </span>
            )}
            <span className="text-sm font-medium text-neutral-800">{ctaLabel}</span>
          </div>
        </div>

        <div className="flex flex-col justify-start border-l border-neutral-100/80 pl-3 pt-1 text-right">
          {renderPrice(useHorizontalLayout && !isWideLayout)}
        </div>

      </article>
      )}
    </Link>
  );
}
