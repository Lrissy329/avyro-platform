'use client';

import Link from "next/link";
import Image from "next/image";
import { Listing } from "@/types/Listing";
import { supabase } from "@/lib/supabaseClient";
import { formatReviewSummaryLineFromScore } from "@/lib/reviews";

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
  return value.replace(/_/g, " ");
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);

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

export const ListingCard = ({ listing, staySummary, onHover, onLeave, onSelect }: Props) => {
  const title = listing.title || (listing as any).name || "Untitled listing";
  const location = shortLocation(listing.location || (listing as any).city || "");
  const locationLabel =
    listing.coordsMissing
      ? listing.locationFallback ?? "Location unavailable"
      : location;
  const bookingUnit =
    (listing.booking_unit ?? listing.bookingUnit ?? (listing as any).booking_unit) === "hourly"
      ? "hourly"
      : "nightly";
  const basePrice =
    bookingUnit === "hourly"
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
  const imageSrc = pickImage(listing);
  const unitLabel = bookingUnit === "hourly" ? "hour" : "night";
  const modeLabel = bookingUnit === "hourly" ? "Day-use" : "Overnight";
  const isEntirePlace =
    typeValue && normaliseType(typeValue).toLowerCase().includes("entire");
  const metaLine = [locationLabel, isEntirePlace ? "Entire place" : null]
    .filter(Boolean)
    .join(" · ");

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
  const showStayTotal = basePrice != null && stayUnits > 0;
  const stayTotal = showStayTotal ? basePrice * stayUnits : null;

  return (
    <Link
      href={listingId ? `/listing/${listingId}` : "#"}
      className="block no-underline hover:no-underline"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={() => onSelect?.()}
    >
      <article className="flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white transition hover:shadow-md cursor-pointer">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch">
          <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl sm:h-[140px] sm:w-[200px] sm:shrink-0">
          <Image
            src={imageSrc}
            alt={title || "Listing image"}
            fill
            className="h-full w-full object-cover"
            sizes="(max-width: 768px) 100vw, 220px"
          />
          {modeLabel && (
            <span className="absolute left-3 top-3 rounded-full bg-[#0B0D10] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
              {modeLabel}
            </span>
          )}
          </div>
          <div className="flex flex-1 flex-col justify-between gap-3 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1">
              <h3 className="line-clamp-2 text-base font-medium text-neutral-900 font-display">
                {title}
              </h3>
              {reviewLine ? (
                <p className="line-clamp-1 text-xs text-[#4B5563] font-mono tabular-nums">
                  {reviewLine}
                </p>
              ) : null}
              {metaLine ? (
                <p className="line-clamp-1 text-sm text-[#4B5563]">{metaLine}</p>
              ) : null}
            </div>
            <div className="flex min-w-[140px] flex-col items-end justify-between text-right">
              <div className="mt-auto">
                {showStayTotal && stayTotal != null ? (
                  <>
                    <div className="text-lg font-semibold text-neutral-900 font-mono tabular-nums">
                      {formatCurrency(stayTotal)}
                    </div>
                    <div className="text-xs text-[#4B5563]">
                      {stayUnits} {stayUnits === 1 ? unitLabel : `${unitLabel}s`},{" "}
                      {formatCurrency(basePrice)} / {unitLabel}
                    </div>
                  </>
                ) : basePrice != null ? (
                  <>
                    <div className="text-lg font-semibold text-neutral-900 font-mono tabular-nums">
                      {formatCurrency(basePrice)} / {unitLabel}
                    </div>
                    <div className="text-xs text-[#4B5563]">All fees included</div>
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
