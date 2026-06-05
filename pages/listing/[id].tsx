import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import AeronoocMap from "@/components/map";
import BookingWidget from "@/components/BookingWidget";
import AvailabilityCalendarNightly from "@/components/AvailabilityCalendarNightly";
import AirportAccessCard from "@/components/listing/AirportAccessCard";
import ListingPhotoGallery from "@/components/listing/ListingPhotoGallery";
import MeetHostSection from "@/components/listing/MeetHostSection";
import ProfileTrustCard from "@/components/listing/ProfileTrustCard";
import { buildReviewSummary } from "@/lib/reviews";
import { supabase } from "@/lib/supabaseClient";
import {
  computePricingFromMajor,
  computeSharedPerPersonWeeklyPricePence,
  getServiceFeeRate,
} from "@/lib/pricing";
import { mapAmenities } from "@/lib/amenities";
import {
  ChatBubbleLeftRightIcon,
  CurrencyPoundIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
type DbListing = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  airport_code: string | null;
  price_per_night: number | null;
  price_per_hour?: number | null;
  price_per_week?: number | null;
  price_per_month?: number | null;
  price_overrides?: Array<{
    label?: string | null;
    start_date: string;
    end_date: string;
    price: number;
  }> | null;
  bathrooms: number | null;
  beds: number | null;
  type: string | null;
  rental_type?: string | null;
  booking_unit?: string | null;
  photos: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  primary_poi_id?: string | null;
  amenities?: string[] | null;
  user_id?: string | null;
  allow_flexible_stays?: boolean | null;
  flexible_stay_mode?: "none" | "extra_night" | "rolling" | string | null;
  flex_min_commitment_nights?: number | null;
  flex_max_extension_nights?: number | null;
  flex_extension_notice_hours?: number | null;
  flex_extension_pricing_mode?: "same_rate" | "premium_10" | string | null;
  flex_rolling_window_days?: number | null;
  flex_pricing_multiplier?: number | null;
  is_shared_stay?: boolean | null;
  shared_total_spots?: number | null;
  shared_weekly_price_pence?: number | null;
  shared_join_mode?: "open" | "approval" | string | null;
  shared_min_weeks?: number | null;
  shared_max_weeks?: number | null;
};
type TransportSummary = {
  public_transport_duration_minutes: number | null;
  public_transport_typical_minutes?: number | null;
  public_transport_buffer_minutes?: number | null;
  public_transport_transfers: number | null;
  public_transport_modes: string[] | null;
  taxi_duration_minutes: number | null;
  taxi_typical_minutes?: number | null;
  taxi_buffer_minutes?: number | null;
  taxi_distance_km: number | null;
  taxi_cost_min: number | null;
  taxi_cost_max: number | null;
};
type HostProfile = {
  full_name: string | null;
  avatar_url: string | null;
  bio?: string | null;
  display_name?: string | null;
  headline?: string | null;
  verification_level?: number | null;
  verification_status?: string | null;
};
type ListingReviewsApiSummary = {
  count: number;
  averages: {
    overall: number;
    accuracy: number;
    cleanliness: number;
    communication: number;
    location: number;
    value: number;
  };
  wouldStayAgainPct: number | null;
};
type ListingReviewsApiReview = {
  id: string;
  reviewerId: string;
  reviewerName: string | null;
  overallScore: number;
  publicComment: string | null;
  createdAt: string | null;
};
type ListingReviewsApiResponse = {
  listingId: string;
  summary: ListingReviewsApiSummary;
  reviews: ListingReviewsApiReview[];
};
const BUCKET = "listing-photos";
const toPublicUrl = (pathOrUrl?: string | null): string | null => {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const key = pathOrUrl.startsWith("/") ? pathOrUrl.slice(1) : pathOrUrl;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data?.publicUrl ?? null;
};

const normalizePhotoEntry = (entry: unknown): string | null => {
  if (!entry) return null;

  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizePhotoEntry(parsed);
      } catch {
        // fall through
      }
    }
    return toPublicUrl(trimmed);
  }

  if (typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const directKeys = ["publicUrl", "url", "src", "href"];
    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const pathKeys = ["path", "fullPath", "key"];
    for (const key of pathKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return toPublicUrl(value.trim());
    }
  }

  return null;
};
const RENTAL_TYPE_LABELS: Record<string, string> = {
  overnight_stay: "Overnight stay",
  crashpad: "Extended stay",
  day_use: "Day-use",
  split_rest: "Split rest",
};
const RENTAL_TYPE_DETAILS: Record<string, string> = {
  overnight_stay: "Traditional overnight stays with check-in and check-out dates.",
  crashpad: "Longer-term stays booked nightly for crew rotations.",
  day_use: "Short daytime stays booked by the hour.",
  split_rest: "Short rest windows between shifts, booked by the hour.",
};
const BOOKING_UNIT_LABELS: Record<"nightly" | "hourly", string> = {
  nightly: "Nightly stays",
  hourly: "Hourly stays",
};
const BOOKING_UNIT_DETAILS: Record<"nightly" | "hourly", string> = {
  nightly: "Choose check-in and check-out dates to book.",
  hourly: "Choose a day and time window to book.",
};

const FALLBACK_AMENITIES = [
  "wifi",
  "dedicated_workspace",
  "kitchen_access",
  "laundry",
  "self_check_in",
  "distance_to_airport",
  "parking",
];
const REVIEW_ICON_MAP: Record<string, (typeof SparklesIcon)> = {
  Cleanliness: SparklesIcon,
  Accuracy: ShieldCheckIcon,
  Communication: ChatBubbleLeftRightIcon,
  Location: MapPinIcon,
  Value: CurrencyPoundIcon,
};
const LaurelIcon = () => (
  <svg
    viewBox="0 0 64 32"
    role="presentation"
    aria-hidden="true"
    className="h-10 w-10 text-slate-600"
  >
    <path
      d="M6 28c6-4 8-9 9-15M2 22c4-3 6-7 7-12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M58 28c-6-4-8-9-9-15M62 22c-4-3-6-7-7-12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);
const formatCurrency = (value: number, currency = 'GBP') => new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const pluralise = (value: number | null | undefined, unit: string) => {
  if (!value) return `0 ${unit}${unit.endsWith("s") ? "" : "s"}`;
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
};
const formatFullDate = (date?: Date | null) => {
  if (!date) return "Add date";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};
const formatShortRange = (date?: Date | null) => {
  if (!date) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export default function ListingDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [listing, setListing] = useState<DbListing | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [host, setHost] = useState<HostProfile | null>(null);
  const [transportSummary, setTransportSummary] = useState<TransportSummary | null>(null);
  const [listingReviews, setListingReviews] = useState<ListingReviewsApiResponse | null>(null);
  const [showMobileBookingSheet, setShowMobileBookingSheet] = useState(false);
  const [nightlyRange, setNightlyRange] = useState<{ from: Date | null; to: Date | null }>({
    from: null,
    to: null,
  });
  const mobileSheetCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const [guests, setGuests] = useState({
    adults: 1,
    children: 0,
    infants: 0,
    pets: 0,
  });
  const [showGuests, setShowGuests] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const totalGuests = useMemo(
    () => guests.adults + guests.children + guests.infants + guests.pets,
    [guests]
  );
  const rentalTypeLabel = listing?.rental_type
    ? RENTAL_TYPE_LABELS[listing.rental_type] ?? listing.rental_type.replace(/_/g, " ")
    : null;
  const rentalTypeDetail = listing?.rental_type
    ? RENTAL_TYPE_DETAILS[listing.rental_type] ?? "This stay is optimized for crew schedules."
    : "This stay is optimized for crew schedules.";
  const isHourlyListing = listing?.booking_unit === "hourly";
  const bookingUnit: "nightly" | "hourly" = isHourlyListing ? "hourly" : "nightly";
  const listingFlexibleMode: "none" | "extra_night" | "rolling" =
    listing?.flexible_stay_mode === "rolling"
      ? "rolling"
      : listing?.flexible_stay_mode === "extra_night"
      ? "extra_night"
      : "none";
  const bookingUnitLabel = BOOKING_UNIT_LABELS[bookingUnit];
  const bookingUnitDetail = BOOKING_UNIT_DETAILS[bookingUnit];
  useEffect(() => {
    if (!id || typeof id !== "string") return;
    (async () => {
      setLoading(true);
      const listingResponse = await fetch(`/api/listings/${id}`);
      const listingPayload = await listingResponse.json().catch(() => null);
      if (!listingResponse.ok || !listingPayload) {
        console.error("Error fetching listing:", listingPayload?.error ?? "Request failed");
        setListing(null);
        setLoading(false);
        return;
      }
      const data = listingPayload as DbListing;
      let rawPhotos: unknown = data.photos;
      if (typeof rawPhotos === "string") {
        try {
          rawPhotos = JSON.parse(rawPhotos);
        } catch {
          rawPhotos = [];
        }
      }
      if (rawPhotos && typeof rawPhotos === "object" && !Array.isArray(rawPhotos)) {
        rawPhotos = Object.values(rawPhotos as Record<string, unknown>);
      }
      const normalizedPhotos = Array.isArray(rawPhotos)
        ? (rawPhotos
            .map((entry: unknown) => normalizePhotoEntry(entry))
            .filter(Boolean) as string[])
        : [];
      const mappedListing: DbListing = {
        ...(data as DbListing),
        allow_flexible_stays: data.allow_flexible_stays ?? false,
        flexible_stay_mode: data.flexible_stay_mode ?? "none",
        flex_min_commitment_nights: data.flex_min_commitment_nights ?? 7,
        flex_max_extension_nights: data.flex_max_extension_nights ?? 7,
        flex_extension_notice_hours: data.flex_extension_notice_hours ?? 24,
        flex_extension_pricing_mode: data.flex_extension_pricing_mode ?? "same_rate",
        flex_rolling_window_days: data.flex_rolling_window_days ?? 3,
        flex_pricing_multiplier: data.flex_pricing_multiplier ?? 1.1,
        is_shared_stay: data.is_shared_stay ?? false,
        shared_total_spots: data.shared_total_spots ?? 0,
        shared_weekly_price_pence: data.shared_weekly_price_pence ?? null,
        shared_join_mode: data.shared_join_mode ?? "open",
        shared_min_weeks: data.shared_min_weeks ?? 1,
        shared_max_weeks: data.shared_max_weeks ?? 12,
      };
      setListing(mappedListing);
      setPhotoUrls(normalizedPhotos);
      if (data.primary_poi_id) {
        const { data: transportRow } = await supabase
          .from("listing_transport_summaries")
          .select(
            "public_transport_duration_minutes, public_transport_typical_minutes, public_transport_buffer_minutes, public_transport_transfers, public_transport_modes, taxi_duration_minutes, taxi_typical_minutes, taxi_buffer_minutes, taxi_distance_km, taxi_cost_min, taxi_cost_max"
          )
          .eq("listing_id", data.id)
          .eq("poi_id", data.primary_poi_id)
          .maybeSingle();
        setTransportSummary((transportRow as TransportSummary) ?? null);
      } else {
        setTransportSummary(null);
      }
      setLoading(false);
      if (data.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, avatar_url, display_name, headline, bio, verification_level, verification_status")
          .eq("id", data.user_id)
          .single();
        if (profile) setHost(profile as HostProfile);
      }
    })();
  }, [id]);
  useEffect(() => {
    if (!id || typeof id !== "string") return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/reviews/listing?listingId=${encodeURIComponent(id)}`
        );
        if (!response.ok) return;
        const payload = (await response.json()) as ListingReviewsApiResponse;
        if (!cancelled) {
          setListingReviews(payload);
        }
      } catch (error) {
        console.error("[listing] failed to load listing reviews", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);
  const nightlyRate = !isHourlyListing ? listing?.price_per_night ?? null : null;
  const hourlyRate = isHourlyListing ? listing?.price_per_hour ?? null : null;
  const baseRate = isHourlyListing ? hourlyRate : nightlyRate;
  const nights = useMemo(() => {
    if (!nightlyRange?.from || !nightlyRange?.to) return 0;
    const start = nightlyRange.from;
    const end = nightlyRange.to;
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0;
    const diff = end.getTime() - start.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
  }, [nightlyRange]);
  const hasSelectedNightRange = Boolean(nightlyRange?.from && nightlyRange?.to && nights > 0);
  type BasePricing = {
    base: number;
    weeklySavings: number | null;
    monthlySavings: number | null;
  };

  const basePricing = useMemo<BasePricing | null>(() => {
    if (!nightlyRate || nights <= 0) return null;
    const weeklyRate = listing?.price_per_week || null;
    const monthlyRate = listing?.price_per_month || null;
    let remaining = nights;
    let cost = 0;
    let weeklySavings: number | null = null;
    let monthlySavings: number | null = null;

    if (monthlyRate && remaining >= 28) {
      const months = Math.floor(remaining / 28);
      if (months > 0) {
        const monthlyPortion = months * 28 * nightlyRate;
        const monthlyCost = months * monthlyRate;
        monthlySavings = Math.max(0, monthlyPortion - monthlyCost);
        cost += monthlyCost;
        remaining -= months * 28;
      }
    }

    if (weeklyRate && remaining >= 7) {
      const weeks = Math.floor(remaining / 7);
      if (weeks > 0) {
        const weeklyPortion = weeks * 7 * nightlyRate;
        const weeklyCost = weeks * weeklyRate;
        weeklySavings = Math.max(0, weeklyPortion - weeklyCost);
        cost += weeklyCost;
        remaining -= weeks * 7;
      }
    }

    cost += remaining * nightlyRate;
    return { base: cost, weeklySavings, monthlySavings };
  }, [nightlyRate, nights, listing?.price_per_week, listing?.price_per_month]);

  const pricingBreakdown = useMemo(() => {
    if (!basePricing) return null;
    const breakdown = computePricingFromMajor(basePricing.base);
    return {
      ...breakdown,
      weeklySavings: basePricing.weeklySavings,
      monthlySavings: basePricing.monthlySavings,
    };
  }, [basePricing]);
  const serviceFeeRate = getServiceFeeRate();
  const amenityDescriptors = useMemo(
    () =>
      mapAmenities(
        listing?.amenities && listing.amenities.length > 0 ? listing.amenities : FALLBACK_AMENITIES
      ),
    [listing?.amenities?.join("|") ?? "__fallback__"]
  );
  const airportAreaLabel = listing?.airport_code ? listing.airport_code : null;
  const galleryCommuteBadge = useMemo(() => {
    if (!airportAreaLabel) return null;
    const duration =
      transportSummary?.taxi_typical_minutes ?? transportSummary?.taxi_duration_minutes ?? null;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return null;
    return `${Math.round(duration)} min to ${airportAreaLabel}`;
  }, [airportAreaLabel, transportSummary]);
  const hostName = (host?.display_name || host?.full_name || "Your host").trim();
  const hostHeadline =
    host?.headline?.trim() ||
    (airportAreaLabel ? `Professional host near ${airportAreaLabel}` : "Professional-ready stay host");
  const hostAvatarUrl = host?.avatar_url ? toPublicUrl(host.avatar_url) ?? host.avatar_url : null;
  const hostSummaryText = "Professional-ready accommodation for airport-area travellers.";
  const mobileBookingBarLabel = useMemo(() => {
    if (listing?.is_shared_stay) return "Join shared stay";
    if (listing?.allow_flexible_stays && listingFlexibleMode !== "none") return "Book with flexibility";
    return "Reserve";
  }, [listing?.allow_flexible_stays, listing?.is_shared_stay, listingFlexibleMode]);
  const mobileBookingPriceLine = useMemo(() => {
    if (listing?.is_shared_stay) {
      const weekly = listing.shared_weekly_price_pence;
      const totalSpots = Math.max(1, Math.round(Number(listing.shared_total_spots ?? 1)) || 1);
      if (typeof weekly === "number" && Number.isFinite(weekly) && weekly > 0) {
        const perPersonWeeklyPence = computeSharedPerPersonWeeklyPricePence({
          totalWeeklyPricePence: weekly,
          totalSpots,
        }).rounded_per_person_weekly_pence;
        return `${formatCurrency(perPersonWeeklyPence / 100)} / person / week`;
      }
      return "Check price";
    }
    if (typeof baseRate === "number" && Number.isFinite(baseRate) && baseRate > 0) {
      return `${formatCurrency(baseRate)} / ${isHourlyListing ? "hour" : "night"}`;
    }
    return "Check price";
  }, [
    baseRate,
    isHourlyListing,
    listing?.is_shared_stay,
    listing?.shared_total_spots,
    listing?.shared_weekly_price_pence,
  ]);
  const mobileBookingDateSummary = hasSelectedNightRange
    ? `${formatShortRange(nightlyRange.from)} – ${formatShortRange(nightlyRange.to)}`
    : "Select dates";
  const reviewSummary = useMemo(() => {
    if (listingReviews?.summary?.count && listingReviews.summary.count > 0) {
      const averages = listingReviews.summary.averages;
      return buildReviewSummary(
        {
          cleanliness: averages.cleanliness ?? 0,
          accuracy: averages.accuracy ?? 0,
          communication: averages.communication ?? 0,
          location: averages.location ?? 0,
          value: averages.value ?? 0,
        },
        listingReviews.summary.count
      );
    }

    if (listing && (listing as any).review_scores) {
      const scores = (listing as any).review_scores;
      if (
        scores &&
        typeof scores === "object" &&
        typeof scores.cleanliness === "number" &&
        typeof scores.accuracy === "number" &&
        typeof scores.location === "number" &&
        typeof scores.value === "number"
      ) {
        return buildReviewSummary(
          {
            cleanliness: Number(scores.cleanliness ?? 0),
            accuracy: Number(scores.accuracy ?? 0),
            communication: Number(scores.communication ?? scores.host ?? 0),
            location: Number(scores.location ?? scores.transport ?? 0),
            value: Number(scores.value ?? 0),
          },
          Number((listing as any).review_count ?? 0)
        );
      }
    }
    return buildReviewSummary(
      {
        cleanliness: 0,
        accuracy: 0,
        communication: 0,
        location: 0,
        value: 0,
      },
      Number((listing as any)?.review_count ?? 0)
    );
  }, [listing, listingReviews]);
  const publicReviewComments = useMemo(
    () =>
      (listingReviews?.reviews ?? []).filter(
        (review) => typeof review.publicComment === "string" && review.publicComment.trim().length > 0
      ),
    [listingReviews]
  );
  const hasPublishedReviews = reviewSummary.total > 0;
  const hostReviewFact = hasPublishedReviews ? `${reviewSummary.total} verified stay reviews` : "New host";
  const handleClearDates = () => {
    setNightlyRange({ from: null, to: null });
  };
  useEffect(() => {
    if (!showMobileBookingSheet) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileSheetCloseButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowMobileBookingSheet(false);
      }
    };
    const media = window.matchMedia("(min-width: 1024px)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setShowMobileBookingSheet(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    media.addEventListener("change", handleMediaChange);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      media.removeEventListener("change", handleMediaChange);
    };
  }, [showMobileBookingSheet]);
  const handleBooking = async () => {
    if (!listing) return;
    setBookingError(null);
    setBookingSuccess(false);
    if (!nightlyRange?.from || !nightlyRange?.to) {
      setBookingError("Please select check-in and check-out dates.");
      return;
    }
    if (totalGuests <= 0) {
      setBookingError("Guest count must be at least 1.");
      return;
    }
    setBookingLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const user = data.user;
      if (!user) {
        router.push(`/login?redirect=${encodeURIComponent(router.asPath)}`);
        return;
      }
      const guestId = user.id;
      const hostId = listing.user_id || null;
      if (!hostId) {
        setBookingError("Host information missing; cannot create booking.");
        return;
      }
      const checkInDate = nightlyRange.from;
      const checkOutDate = nightlyRange.to;
      if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
        setBookingError("Invalid dates selected.");
        return;
      }
      if (checkOutDate <= checkInDate) {
        setBookingError("Check-out must be after check-in.");
        return;
      }
      const { error } = await supabase.from("bookings").insert({
        listing_id: listing.id,
        host_id: hostId,
        guest_id: guestId,
        status: "pending",
        check_in_time: checkInDate.toISOString(),
        check_out_time: checkOutDate.toISOString(),
        guests_total: totalGuests,
      });
      if (error) throw error;
      setBookingSuccess(true);
    } catch (err: any) {
      console.error(err);
      setBookingError(err?.message ?? "Unable to create booking. Please try again.");
    } finally {
      setBookingLoading(false);
    }
  };
  if (loading) return <main className="p-6 text-sm text-gray-600">Loading listing…</main>;
  if (!listing) return <main className="p-6 text-red-600">Listing not found.</main>;
  return (
    <main className="min-h-screen bg-slate-50 pb-28 lg:pb-16">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Stay</p>
            <h1 className="text-3xl font-semibold text-slate-900">{listing.title}</h1>
            <p className="text-sm text-slate-500">
              {listing.location}
              {listing.airport_code ? (
                <>
                  {" "}
                  • Near{" "}
                  <span className="font-mono tabular-nums">{listing.airport_code}</span>
                </>
              ) : (
                ""
              )}
            </p>
          </div>
          <div className="flex gap-2 text-sm font-semibold text-slate-700">
            <button className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 hover:border-slate-500">
              Share
            </button>
            <button className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 hover:border-slate-500">
              Save
            </button>
          </div>
        </header>
        <ListingPhotoGallery
          photos={photoUrls}
          title={listing.title}
          commuteBadge={galleryCommuteBadge}
        />
        <section className="mt-10 grid gap-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-start">
          <div className="space-y-12">
            <div className="space-y-10 rounded-3xl bg-white p-6 shadow-sm">
              <div className="space-y-6 border-b border-slate-100 pb-6">
                <div>
                  <div className="flex flex-wrap gap-2 text-sm text-slate-500">
                    {rentalTypeLabel && <span>{rentalTypeLabel}</span>}
                    <span>{listing.type?.replace(/_/g, " ") ?? "Private stay"}</span>
                    <span>• {pluralise(listing.beds, "bed")}</span>
                    <span>• {pluralise(listing.bathrooms, "bath")}</span>
                  </div>
                  <p className="text-sm text-slate-500">
                    Professional-ready accommodation with straightforward airport access and practical comforts.
                  </p>
                </div>
                <ProfileTrustCard
                  compact
                  name={hostName}
                  avatarUrl={hostAvatarUrl}
                  eyebrow="Hosted by"
                  title={`Hosted by ${hostName}`}
                  subtitle={hostHeadline}
                  supportingText={hostSummaryText}
                  trustBadges={[
                    { type: "flexivo_host" },
                    ...(airportAreaLabel ? [{ type: "airport_local" as const, label: `Near ${airportAreaLabel}` }] : []),
                  ]}
                  className="bg-slate-50/90"
                />
              </div>
              <div className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Stay type</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {rentalTypeLabel ?? "Stay"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{rentalTypeDetail}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">How guests book</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{bookingUnitLabel}</p>
                  <p className="mt-1 text-sm text-slate-600">{bookingUnitDetail}</p>
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">About this place</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 whitespace-pre-line">
                  {listing.description ||
                    "A thoughtfully curated pad close to key transport links. Expect hotel-level comforts with the privacy of your own space."}
                </p>
              </div>
              <AirportAccessCard
                airportCode={listing.airport_code}
                driveMinutes={
                  transportSummary?.taxi_typical_minutes ??
                  transportSummary?.taxi_duration_minutes ??
                  null
                }
                taxiMinutes={
                  transportSummary?.taxi_typical_minutes ??
                  transportSummary?.taxi_duration_minutes ??
                  null
                }
                publicTransportMinutes={
                  transportSummary?.public_transport_typical_minutes ??
                  transportSummary?.public_transport_duration_minutes ??
                  null
                }
                publicTransportModes={transportSummary?.public_transport_modes ?? null}
              />
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Where you’ll sleep</p>
                  <p className="text-sm text-slate-600">
                    {isHourlyListing
                      ? pluralise(listing.beds, "rest space")
                      : `${pluralise(listing.beds, "bed")} - ${listing.type?.replace(/_/g, " ") ?? "Room"}`}
                  </p>
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">What this place offers</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {amenityDescriptors.map(({ code, label, Icon }) => (
                    <div
                      key={code}
                      className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                    >
                      <Icon className="h-5 w-5 text-slate-500" aria-hidden="true" />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-100 p-5">
                <h3 className="text-lg font-semibold text-slate-900">Things to know</h3>
                <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                  <div>
                    <p className="font-semibold text-slate-800">Rules</p>
                    <p>No smoking • No parties • Respect quiet hours</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">Cancellation</p>
                    <p>Flexible: full refund up to 24h before check‑in</p>
                  </div>
                </div>
              </div>
            </div>
            {!isHourlyListing && (
              <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">Availability</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {hasSelectedNightRange
                        ? `${nights} night${nights === 1 ? "" : "s"} selected · ${formatShortRange(
                            nightlyRange.from
                          )} – ${formatShortRange(nightlyRange.to)}`
                        : "Select dates to check availability"}
                    </p>
                  </div>
                  {hasSelectedNightRange ? (
                    <button
                      type="button"
                      onClick={handleClearDates}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:text-slate-900"
                    >
                      Clear dates
                    </button>
                  ) : null}
                </div>

                {hasSelectedNightRange ? (
                  <>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                      <AvailabilityCalendarNightly
                        listingId={listing.id}
                        selectedRange={nightlyRange}
                        onSelectRange={setNightlyRange}
                        variant="inline"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium text-slate-500">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full border border-slate-300 bg-white" />
                        Available
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-[rgba(11,13,16,0.12)]" />
                        Booked
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-[rgba(11,13,16,0.06)]" />
                        Blocked
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    Select dates to check availability.
                  </div>
                )}
              </section>
            )}

          </div>

          <aside className="hidden self-start lg:sticky lg:top-24 lg:block">
            <BookingWidget
              listingId={listing.id}
              listingTitle={listing.title}
              basePrice={baseRate}
              hostId={listing.user_id ?? ""}
              isSharedStay={Boolean(listing.is_shared_stay)}
              sharedTotalSpots={listing.shared_total_spots ?? 0}
              sharedWeeklyPricePence={listing.shared_weekly_price_pence ?? null}
              sharedJoinMode={listing.shared_join_mode ?? "open"}
              sharedMinWeeks={listing.shared_min_weeks ?? 1}
              sharedMaxWeeks={listing.shared_max_weeks ?? 12}
              allowFlexibleStays={listing.allow_flexible_stays ?? false}
              flexibleStayMode={listingFlexibleMode}
              flexMinCommitmentNights={listing.flex_min_commitment_nights ?? 7}
              flexMaxExtensionNights={listing.flex_max_extension_nights ?? 7}
              flexExtensionNoticeHours={listing.flex_extension_notice_hours ?? 24}
              flexExtensionPricingMode={
                listing.flex_extension_pricing_mode === "premium_10"
                  ? "premium_10"
                  : "same_rate"
              }
              flexRollingWindowDays={listing.flex_rolling_window_days ?? 3}
              flexPricingMultiplier={listing.flex_pricing_multiplier ?? 1.1}
              bookingUnit={listing.booking_unit === "hourly" ? "hourly" : "nightly"}
              rentalType={listing.rental_type}
              nightlyRange={nightlyRange}
              onNightlyRangeChange={setNightlyRange}
            />
          </aside>
        </section>
        <section className="mt-12">
          <MeetHostSection
            hostName={hostName}
            hostAvatarUrl={hostAvatarUrl}
            headline={hostHeadline}
            bio={host?.bio ?? null}
            reviewFact={hostReviewFact}
            airportLabel={airportAreaLabel}
          />
        </section>
        <section className="mt-12 space-y-8" aria-label="Location and reviews">
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Where you’ll be</h3>
              <p className="text-sm text-slate-500">
                {listing.location ?? "Location details coming soon"}
              </p>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              {typeof listing.latitude === "number" &&
              !Number.isNaN(listing.latitude) &&
              typeof listing.longitude === "number" &&
              !Number.isNaN(listing.longitude) ? (
                <AeronoocMap
                  latitude={listing.latitude}
                  longitude={listing.longitude}
                  zoom={13}
                  height={320}
                      listings={[
                        {
                          id: listing.id,
                          latitude: listing.latitude,
                          longitude: listing.longitude,
                          title: listing.title,
                          price_per_night: baseRate ?? undefined,
                        },
                      ]}
                    />
              ) : (
                <div className="grid h-64 place-items-center bg-slate-50 text-sm text-slate-500">
                  Location pin coming soon once the host confirms their coordinates.
                </div>
              )}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <LaurelIcon />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Guest rating
                  </p>
                  <p className="text-3xl font-semibold text-slate-900">
                    {hasPublishedReviews ? reviewSummary.overall.toFixed(1) : "—"}
                    <span className="text-base font-medium text-slate-500"> / 10</span>
                  </p>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {hasPublishedReviews
                    ? `${reviewSummary.overall.toFixed(1)}${
                        reviewSummary.label ? ` · ${reviewSummary.label}` : ""
                      } · ${reviewSummary.total} reviews`
                    : "No published reviews yet"}
                </p>
                <p className="text-sm text-slate-500">
                  Ratings reflect verified stays and post-trip feedback.
                </p>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {reviewSummary.categories.map((metric) => {
                const IconComponent = REVIEW_ICON_MAP[metric.label];
                return (
                  <div key={metric.label}>
                    <div className="flex items-center justify-between text-sm text-slate-600">
                      <div className="flex items-center gap-2 font-semibold text-slate-900">
                        {IconComponent && (
                          <IconComponent className="h-4 w-4 text-slate-400" aria-hidden="true" />
                        )}
                        <span>{metric.label}</span>
                      </div>
                      <p className="font-semibold">{metric.score.toFixed(1)}</p>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-slate-900"
                        style={{ width: `${(metric.score / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-8">
              <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                Guest comments
              </h4>
              {publicReviewComments.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {publicReviewComments.slice(0, 8).map((review) => (
                    <article
                      key={review.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">
                          {review.reviewerName ?? "Guest"}
                        </span>
                        <span>
                          {review.createdAt
                            ? new Date(review.createdAt).toLocaleDateString("en-GB")
                            : "Recent stay"}
                          {" · "}
                          {review.overallScore.toFixed(1)}/10
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{review.publicComment}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  No published comments yet for this listing.
                </p>
              )}
            </div>
          </div>
        </section>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <button className="underline-offset-4 hover:underline">Report this listing</button>
          <p>&copy; {new Date().getFullYear()} Veloro — inspired by Airbnb excellence</p>
        </footer>
      </div>
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/96 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">
              {mobileBookingPriceLine}
            </p>
            <p className="truncate text-xs text-slate-500">{mobileBookingDateSummary}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowMobileBookingSheet(true)}
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            {mobileBookingBarLabel}
          </button>
        </div>
      </div>

      {showMobileBookingSheet ? (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden" aria-modal="true" role="dialog">
          <button
            type="button"
            aria-label="Close booking sheet"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setShowMobileBookingSheet(false)}
          />
          <div
            className="relative z-10 max-h-[85vh] w-full overflow-hidden rounded-t-[2rem] bg-slate-50 shadow-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
              <div>
                <p className="text-sm font-semibold text-slate-900">{mobileBookingPriceLine}</p>
                <p className="text-xs text-slate-500">{mobileBookingDateSummary}</p>
              </div>
              <button
                ref={mobileSheetCloseButtonRef}
                type="button"
                onClick={() => setShowMobileBookingSheet(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white px-0 text-lg font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
              >
                ×
              </button>
            </div>
            <div
              className="overflow-y-auto px-4 py-4 sm:px-6"
              style={{ maxHeight: "calc(85vh - 4.5rem - env(safe-area-inset-bottom))" }}
            >
              <BookingWidget
                listingId={listing.id}
                listingTitle={listing.title}
                basePrice={baseRate}
                hostId={listing.user_id ?? ""}
                isSharedStay={Boolean(listing.is_shared_stay)}
                sharedTotalSpots={listing.shared_total_spots ?? 0}
                sharedWeeklyPricePence={listing.shared_weekly_price_pence ?? null}
                sharedJoinMode={listing.shared_join_mode ?? "open"}
                sharedMinWeeks={listing.shared_min_weeks ?? 1}
                sharedMaxWeeks={listing.shared_max_weeks ?? 12}
                allowFlexibleStays={listing.allow_flexible_stays ?? false}
                flexibleStayMode={listingFlexibleMode}
                flexMinCommitmentNights={listing.flex_min_commitment_nights ?? 7}
                flexMaxExtensionNights={listing.flex_max_extension_nights ?? 7}
                flexExtensionNoticeHours={listing.flex_extension_notice_hours ?? 24}
                flexExtensionPricingMode={
                  listing.flex_extension_pricing_mode === "premium_10"
                    ? "premium_10"
                    : "same_rate"
                }
                flexRollingWindowDays={listing.flex_rolling_window_days ?? 3}
                flexPricingMultiplier={listing.flex_pricing_multiplier ?? 1.1}
                bookingUnit={listing.booking_unit === "hourly" ? "hourly" : "nightly"}
                rentalType={listing.rental_type}
                nightlyRange={nightlyRange}
                onNightlyRangeChange={setNightlyRange}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
