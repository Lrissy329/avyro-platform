import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AeronoocMap from "@/components/map";
import BookingWidget from "@/components/BookingWidget";
import AvailabilityCalendarNightly from "@/components/AvailabilityCalendarNightly";
import { buildReviewSummary, getFallbackReviewSummary } from "@/lib/reviews";
import { supabase } from "@/lib/supabaseClient";
import { computePricingFromMajor, getServiceFeeRate } from "@/lib/pricing";
import { mapAmenities } from "@/lib/amenities";
import {
  ChatBubbleLeftRightIcon,
  CurrencyPoundIcon,
  ClockIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TruckIcon,
  MoonIcon,
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
  headline?: string | null;
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
const formatTransportModes = (modes?: string[] | null) => {
  if (!modes || modes.length === 0) return null;
  const map: Record<string, string> = {
    BUS: "Bus",
    RAIL: "Rail",
    SUBWAY: "Underground",
    TRAIN: "Train",
    TRAM: "Tram",
    FERRY: "Ferry",
  };
  return modes
    .map((mode) => map[mode] ?? mode.toLowerCase())
    .map((mode) => mode.charAt(0).toUpperCase() + mode.slice(1))
    .join(" + ");
};
const formatMinuteRange = (typical?: number | null, buffer?: number | null) => {
  if (!typical) return null;
  if (!buffer || buffer <= typical) return `${typical} min`;
  return `${typical}–${buffer} min`;
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
  "Comfort & rest quality": MoonIcon,
  "Location & access": MapPinIcon,
  Value: CurrencyPoundIcon,
  "Host reliability": ChatBubbleLeftRightIcon,
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
  const [nightlyRange, setNightlyRange] = useState<{ from: Date | null; to: Date | null }>({
    from: null,
    to: null,
  });
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
  const bookingUnitLabel = BOOKING_UNIT_LABELS[bookingUnit];
  const bookingUnitDetail = BOOKING_UNIT_DETAILS[bookingUnit];
  const transitLine = useMemo(() => {
    const duration =
      transportSummary?.public_transport_typical_minutes ??
      transportSummary?.public_transport_duration_minutes ??
      null;
    const buffer = transportSummary?.public_transport_buffer_minutes ?? null;
    const timeRange = formatMinuteRange(duration, buffer);
    if (!timeRange) return null;
    const transfers = transportSummary.public_transport_transfers;
    const changeLabel =
      transfers == null
        ? null
        : transfers === 0
        ? "Direct"
        : `${transfers} change${transfers === 1 ? "" : "s"}`;
    const modes = formatTransportModes(transportSummary.public_transport_modes);
    return [timeRange, changeLabel, modes].filter(Boolean).join(" · ");
  }, [transportSummary]);
  const taxiLine = useMemo(() => {
    const duration =
      transportSummary?.taxi_typical_minutes ??
      transportSummary?.taxi_duration_minutes ??
      null;
    const buffer = transportSummary?.taxi_buffer_minutes ?? null;
    const timeRange = formatMinuteRange(duration, buffer);
    if (!timeRange) return null;
    return timeRange;
  }, [transportSummary]);

  useEffect(() => {
    if (!id || typeof id !== "string") return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("listings")
        .select(
          "id, title, description, location, airport_code, primary_poi_id, price_per_night, price_per_hour, price_per_week, price_per_month, price_overrides, bathrooms, beds, type, rental_type, booking_unit, photos, amenities, user_id, latitude, longitude"
        )
        .eq("id", id)
        .single();
      if (error || !data) {
        console.error("Error fetching listing:", error?.message);
        setListing(null);
        setLoading(false);
        return;
      }
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
      setListing(data as DbListing);
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
          .select("full_name, avatar_url, headline")
          .eq("id", data.user_id)
          .single();
        if (profile) setHost(profile as HostProfile);
      }
    })();
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
  const shortLocation =
    listing?.location?.split(",")[0]?.trim() || listing?.airport_code || listing?.title || "this stay";
  const reviewSummary = useMemo(() => {
    if (listing && (listing as any).review_scores) {
      const scores = (listing as any).review_scores;
      if (
        scores &&
        typeof scores === "object" &&
        typeof scores.cleanliness === "number" &&
        typeof scores.accuracy === "number" &&
        typeof scores.comfort === "number" &&
        typeof scores.location === "number" &&
        typeof scores.value === "number" &&
        typeof scores.host === "number"
      ) {
        return buildReviewSummary(scores, Number((listing as any).review_count ?? 0));
      }
    }
    return getFallbackReviewSummary();
  }, [listing]);
  const heroPhotos = useMemo(() => {
    if (photoUrls.length === 0) return ["/placeholder.jpg"];
    if (photoUrls.length >= 5) return photoUrls.slice(0, 5);
    return [...photoUrls, ...Array(5 - photoUrls.length).fill("/placeholder.jpg")];
  }, [photoUrls]);
  const handleClearDates = () => {
    setNightlyRange({ from: null, to: null });
  };
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
    <main className="min-h-screen bg-slate-50 pb-16">
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
        <section className="relative grid gap-2 rounded-3xl bg-white shadow-sm lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-3xl">
            <div className="aspect-[4/3] lg:aspect-[5/4] w-full bg-slate-100">
              <img
                src={heroPhotos[0]}
                alt="Listing hero"
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
          <div className="hidden grid-cols-2 grid-rows-2 gap-2 lg:grid">
            {heroPhotos.slice(1, 5).map((photo, idx) => (
              <div key={idx} className="relative overflow-hidden rounded-2xl">
                <div className="aspect-[4/3] w-full bg-slate-100">
                  <img
                    src={photo}
                    alt={`Gallery ${idx + 2}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="absolute right-4 top-4 hidden rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white lg:inline-flex lg:items-center lg:gap-2"
            onClick={() => {
              const gallery = document.getElementById("gallery");
              if (gallery) gallery.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Show all photos
          </button>
        </section>
        <section className="mt-10 grid gap-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-start">
          <div className="space-y-12">
            <div className="space-y-10 rounded-3xl bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex flex-wrap gap-2 text-sm text-slate-500">
                    {rentalTypeLabel && <span>{rentalTypeLabel}</span>}
                    <span>{listing.type?.replace(/_/g, " ") ?? "Private stay"}</span>
                    <span>• {pluralise(listing.beds, "bed")}</span>
                    <span>• {pluralise(listing.bathrooms, "bath")}</span>
                  </div>
                  <p className="text-sm text-slate-500">
                    Perfect for travellers looking to be close to the
                    airport and city links.
                  </p>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                  <div className="h-12 w-12 rounded-full bg-slate-100">
                    {host?.avatar_url ? (
                      <img
                        src={toPublicUrl(host.avatar_url) ?? host.avatar_url}
                        alt={host.full_name ?? "Host avatar"}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-500">
                        {(host?.full_name || "Host")
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Hosted by</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {host?.full_name ?? "Your host"}
                    </p>
                    <p className="text-xs text-slate-500">{host?.headline ?? "Superhost"}</p>
                  </div>
                </div>
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
              <div className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Where you’ll sleep</p>
                  <p className="text-sm text-slate-600">
                    {isHourlyListing
                      ? pluralise(listing.beds, "rest space")
                      : `${pluralise(listing.beds, "bed")} - ${listing.type?.replace(/_/g, " ") ?? "Room"}`}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {listing.airport_code ? (
                      <>
                        Getting to{" "}
                        <span className="font-mono tabular-nums">{listing.airport_code}</span>
                      </>
                    ) : (
                      "Getting here"
                    )}
                  </p>
                  {transitLine || taxiLine ? (
                    <div className="mt-2 space-y-2 text-sm text-slate-600">
                      {transitLine && (
                        <div className="flex items-start gap-2">
                          <ClockIcon className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Public transport</span>
                            <span className="text-sm font-medium text-slate-800">{transitLine}</span>
                          </div>
                        </div>
                      )}
                      {taxiLine && (
                        <div className="flex items-start gap-2">
                          <TruckIcon className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Taxi</span>
                            <span className="text-sm font-medium text-slate-800">{taxiLine}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">
                      {listing.airport_code ? (
                        <>
                          10–15 mins from{" "}
                          <span className="font-mono tabular-nums">{listing.airport_code}</span>
                        </>
                      ) : (
                        "Close to airport transfers"
                      )}
                    </p>
                  )}
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

          </div>

          <aside className="lg:sticky lg:top-8 self-start">
            <BookingWidget
              listingId={listing.id}
              basePrice={baseRate}
              hostId={listing.user_id ?? ""}
              bookingUnit={listing.booking_unit}
              rentalType={listing.rental_type}
              nightlyRange={nightlyRange}
              onNightlyRangeChange={setNightlyRange}
            />
          </aside>
        </section>
        {!isHourlyListing && (
          <section className="mt-12">
            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-slate-900">
                    {nights > 0
                      ? `${nights} night${nights > 1 ? "s" : ""} in ${shortLocation}`
                      : "Check availability"}
                  </p>
                  <p className="text-sm text-slate-500">
                    {nightlyRange?.from && nightlyRange?.to
                      ? `${formatShortRange(nightlyRange.from)} – ${formatShortRange(nightlyRange.to)}`
                      : "Select travel dates to see availability."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClearDates}
                  disabled={!nightlyRange?.from && !nightlyRange?.to}
                  className="text-sm font-semibold text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline disabled:opacity-40"
                >
                  Clear dates
                </button>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 p-3 sm:p-5">
                <AvailabilityCalendarNightly
                  listingId={listing.id}
                  selectedRange={nightlyRange}
                  onSelectRange={setNightlyRange}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium text-slate-500">
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
            </div>
          </section>
        )}
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
                    {reviewSummary.overall.toFixed(1)}
                    <span className="text-base font-medium text-slate-500"> / 10</span>
                  </p>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {reviewSummary.overall.toFixed(1)}
                  {reviewSummary.label ? ` · ${reviewSummary.label}` : ""} ·{" "}
                  {reviewSummary.total} reviews
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
          </div>
        </section>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <button className="underline-offset-4 hover:underline">Report this listing</button>
          <p>&copy; {new Date().getFullYear()} Aeronooc — inspired by Airbnb excellence</p>
        </footer>
      </div>
    </main>
  );
}
