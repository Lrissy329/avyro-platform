'use client';

import Link from "next/link";
import Image from "next/image";
import { Listing } from "@/types/Listing";
import { supabase } from "@/lib/supabaseClient";
import { formatReviewSummaryLineFromScore } from "@/lib/reviews";
import { computeGuestStayPricing, computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";

const BUCKET = "listing-photos";
const toPublicUrl = (pathOrUrl?: string | null): string | null => {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const key = pathOrUrl.startsWith("/") ? pathOrUrl.slice(1) : pathOrUrl;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data?.publicUrl ?? null;
};

type ListingLike = Partial<Listing> & {
  thumbnail?: string;
  imageUrl?: string;
  photos?: string[] | null;
  pricePerNight?: number;
  pricePerHour?: number;
  price?: number;
  type?: string;
  roomType?: string;
  isSharedBookingAllowed?: boolean;
  distanceKmToAirport?: number | null;
  driveMinutesToAirport?: number | null;
  booking_unit?: "nightly" | "hourly" | null;
  bookingUnit?: "nightly" | "hourly" | null;
  coordsMissing?: boolean;
  locationFallback?: string;
  review_overall?: number | null;
  review_total?: number | null;
  reviewOverall?: number | null;
  reviewTotal?: number | null;
  isSharedStay?: boolean | null;
  sharedTotalSpots?: number | null;
  sharedWeeklyPricePence?: number | null;
  sharedSpotsRemaining?: number | null;
};

interface Props {
  listing: ListingLike;
  staySummary?: { units: number; unitLabel: "night" | "hour" } | null;
  onHover?: () => void;
  onLeave?: () => void;
  onSelect?: () => void;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normaliseType(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "Type unknown";
  const lower = value.replace(/_/g, " ").toLowerCase();
  if (lower.includes("entire")) return "Entire place";
  if (lower.includes("private")) return "Private room";
  if (lower.includes("shared")) return "Private room";
  return value.replace(/_/g, " ");
}

const formatCurrency = (value: number) => {
  const isWhole = Math.round(value * 100) % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  }).format(value);
};

const shortLocation = (value: unknown) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("·")) return trimmed;
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 2) return parts.join(" · ");
  return `${parts[0]} · ${parts[1]}`;
};

function pickImage(listing: ListingLike): string {
  const rawCandidates = [
    listing.image_url,
    listing.imageUrl,
    listing.thumbnail,
    Array.isArray(listing.photos) ? listing.photos[0] : undefined,
  ].filter((src): src is string => typeof src === "string" && src.length > 0);

  for (const src of rawCandidates) {
    const resolved = toPublicUrl(src);
    if (resolved) return resolved;
  }

  return "/placeholder.jpg";
}

function pluralize(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

export const ListingCard = ({ listing, staySummary, onHover, onLeave, onSelect }: Props) => {
  const rawTitle = listing.title || (listing as any).name || "";
  const location = shortLocation(listing.location || (listing as any).city || "");
  const locationLabel =
    listing.coordsMissing
      ? listing.locationFallback ?? "Location unavailable"
      : location;
  const bookingUnit =
    (listing.booking_unit ?? listing.bookingUnit ?? (listing as any).booking_unit) === "hourly"
      ? "hourly"
      : "nightly";
  const isSharedStay = Boolean((listing as any).isSharedStay ?? (listing as any).is_shared_stay);
  const sharedTotalSpots =
    toNumber((listing as any).sharedTotalSpots) ??
    toNumber((listing as any).shared_total_spots) ??
    null;
  const sharedSpotDivisor = Math.max(1, Math.round(Number(sharedTotalSpots ?? 1)) || 1);
  const sharedWeeklyPriceMajorRaw =
    toNumber((listing as any).sharedWeeklyPricePence) ??
    toNumber((listing as any).shared_weekly_price_pence);
  const sharedWeeklyPriceMajor =
    sharedWeeklyPriceMajorRaw != null
      ? computeSharedPerPersonWeeklyPricePence({
          totalWeeklyPricePence: sharedWeeklyPriceMajorRaw,
          totalSpots: sharedSpotDivisor,
        }).rounded_per_person_weekly_pence / 100
      : null;
  const sharedSpotsRemaining =
    toNumber((listing as any).sharedSpotsRemaining) ??
    toNumber((listing as any).shared_spots_remaining) ??
    toNumber((listing as any).sharedSpotsLeft) ??
    null;
  const hostBasePrice =
    isSharedStay
      ? sharedWeeklyPriceMajor
      : bookingUnit === "hourly"
      ? toNumber((listing as any).price_per_hour) ??
        toNumber(listing.pricePerHour) ??
        toNumber((listing as any).price_per_night) ??
        toNumber(listing.pricePerNight) ??
        toNumber((listing as any).price)
      : toNumber(listing.price_per_night) ??
        toNumber(listing.pricePerNight) ??
        toNumber((listing as any).price);
  const typeValue =
    listing.listing_type ??
    listing.type ??
    listing.roomType ??
    (listing as any).type;
  const typeLabel = normaliseType(typeValue);
  const imageSrc = pickImage(listing);
  const unitLabel = isSharedStay ? "week" : bookingUnit === "hourly" ? "hour" : "night";
  const modeLabel = isSharedStay ? "Shared stay" : bookingUnit === "hourly" ? "Day-use" : "Overnight";
  const beds =
    toNumber((listing as any).beds) ??
    toNumber((listing as any).bedrooms) ??
    null;
  const travelMinutes =
    toNumber((listing as any).driveMinutesToAirport) ??
    toNumber((listing as any).travelMinutesMin) ??
    null;
  const airportCode =
    typeof (listing as any).airportCode === "string"
      ? (listing as any).airportCode
      : null;
  const travelLabel =
    travelMinutes != null
      ? `${Math.round(travelMinutes)} min to ${airportCode ?? "airport"}`
      : null;
  const metadataLine = [
    travelLabel,
    typeLabel !== "Type unknown" ? typeLabel : null,
    isSharedStay
      ? sharedTotalSpots != null
        ? pluralize(Math.max(1, Math.round(sharedTotalSpots)), "spot")
        : null
      : beds != null
      ? pluralize(Math.max(1, Math.round(beds)), "bed")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title =
    rawTitle.trim().length > 0 && rawTitle !== "Untitled listing"
      ? rawTitle
      : isSharedStay
      ? airportCode
        ? `Shared stay near ${airportCode}`
        : "Shared stay near the airport"
      : airportCode
      ? `Crew house near ${airportCode}`
      : "Professional stay near the airport";
  const summaryLine = isSharedStay
    ? (sharedSpotsRemaining ?? 0) > 0
      ? "Join other professionals already staying nearby."
      : "Professional weekly stay near the airport."
    : bookingUnit === "hourly"
    ? "Short-stay room near the airport."
    : "Reliable base for training blocks and rotations.";

  const listingId = (listing as any).id ?? "";
  const reviewOverall = toNumber(
    (listing as any).review_overall ?? (listing as any).reviewOverall
  );
  const reviewTotal = toNumber(
    (listing as any).review_total ?? (listing as any).reviewTotal
  );
  const reviewLine =
    reviewOverall != null && reviewTotal != null && reviewTotal > 0
      ? formatReviewSummaryLineFromScore(reviewOverall, reviewTotal)
      : null;
  const stayUnits = staySummary?.units ?? 0;
  const resolvedUnits = stayUnits > 0 ? stayUnits : 1;
  const stayPricing =
    hostBasePrice != null
      ? computeGuestStayPricing({
          hostNetUnitMajor: hostBasePrice,
          units: resolvedUnits,
          bookingUnit,
          isFirstCompletedBooking: false,
        })
      : null;
  const guestUnitPrice = stayPricing?.guest_unit_avg_major ?? null;
  const stayTotal = stayUnits > 0 ? stayPricing?.guest_total_major ?? null : null;
  const showStayTotal = stayTotal != null;
  const priceValue = showStayTotal && stayTotal != null ? stayTotal : guestUnitPrice;
  const priceDetail = isSharedStay
    ? "per person / week"
    : `per ${unitLabel}`;
  const secondaryPriceLine = isSharedStay
    ? sharedSpotsRemaining != null
      ? sharedSpotsRemaining <= 0
        ? "Full"
        : `${Math.max(0, Math.round(sharedSpotsRemaining))} spot${
            Math.max(0, Math.round(sharedSpotsRemaining)) === 1 ? "" : "s"
          } left`
      : "Weekly shared stay"
    : "All fees included";
  const ctaLabel = isSharedStay ? "Join shared stay →" : "View stay →";

  return (
    <Link
      href={listingId ? `/listing/${listingId}` : "#"}
      prefetch={false}
      className="block no-underline hover:no-underline"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={() => onSelect?.()}
    >
      <article className="flex flex-col overflow-hidden rounded-[26px] border border-neutral-200 bg-white transition hover:shadow-md cursor-pointer">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch sm:p-5">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl sm:h-[156px] sm:w-[224px] sm:shrink-0">
          <Image
            src={imageSrc}
            alt={title || "Listing image"}
            fill
            className="h-full w-full object-cover"
            sizes="(max-width: 768px) 100vw, 224px"
          />
          {modeLabel && (
            <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {modeLabel}
            </span>
          )}
          {travelLabel ? (
            <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {travelLabel}
            </span>
          ) : null}
          </div>
          <div className="flex flex-1 flex-col justify-between gap-4 sm:flex-row sm:gap-6">
            <div className="flex flex-1 flex-col gap-2">
              <h3 className="line-clamp-2 text-[1.02rem] font-medium leading-6 text-neutral-900 font-display">
                {title}
              </h3>
              <p className="line-clamp-2 text-sm leading-5 text-neutral-700">
                {summaryLine}
              </p>
              {metadataLine ? (
                <p className="line-clamp-1 text-sm text-[#4B5563]">{metadataLine}</p>
              ) : null}
              {locationLabel ? (
                <p className="line-clamp-1 text-sm text-neutral-500">{locationLabel}</p>
              ) : null}
              <div className="mt-auto flex items-center gap-3 pt-2">
                {reviewLine ? (
                  <p className="line-clamp-1 text-xs text-[#4B5563] font-mono tabular-nums">
                    {reviewLine}
                  </p>
                ) : null}
                <span className="text-sm font-medium text-neutral-800">{ctaLabel}</span>
              </div>
            </div>
            <div className="flex min-w-[152px] flex-col items-start justify-between text-left sm:items-end sm:text-right">
              <div className="mt-auto">
                {priceValue != null ? (
                  <>
                    <div className="text-[1.35rem] font-semibold text-neutral-900 font-mono tabular-nums">
                      {formatCurrency(priceValue)}
                    </div>
                    <div className="text-xs text-[#4B5563]">{priceDetail}</div>
                    {showStayTotal && stayTotal != null && !isSharedStay ? (
                      <div className="text-xs text-neutral-500">
                        {stayUnits} {stayUnits === 1 ? unitLabel : `${unitLabel}s`}
                      </div>
                    ) : null}
                    <div className="pt-1 text-xs text-neutral-500">
                      {secondaryPriceLine}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
};
