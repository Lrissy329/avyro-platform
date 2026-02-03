import { useRouter } from "next/router";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

import MapListingCard from "@/components/MapListingCard";
import SearchBar from "@/components/SearchBar";
import { supabase } from "@/lib/supabaseClient";

const MapView = dynamic(() => import("@/components/map"), { ssr: false });
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const __DEV__ = process.env.NODE_ENV !== "production";

// ---------------- Coordinates helpers (unchanged) ----------------
const airportCoords: Record<string, [number, number]> = {
  LHR: [-0.4543, 51.47],
  LGW: [-0.1821, 51.1537],
  STN: [0.235, 51.885],
  LTN: [-0.3683, 51.8747],
  MAN: [-2.275, 53.365],
  BHX: [-1.748, 52.4539],
  DUB: [-6.2701, 53.4213],
};
const AIRPORT_OPTIONS = [
  { code: "STN", label: "London Stansted" },
  { code: "LHR", label: "London Heathrow" },
  { code: "LGW", label: "London Gatwick" },
  { code: "LTN", label: "London Luton" },
  { code: "MAN", label: "Manchester" },
  { code: "BHX", label: "Birmingham" },
  { code: "DUB", label: "Dublin" },
];
const POPULAR_AIRPORTS = ["STN", "LHR", "LGW", "MAN", "BHX", "DUB"];
const DEFAULT_AIRPORT = "STN";
function isFiniteNumber(n: any): n is number { return typeof n === "number" && Number.isFinite(n); }
function toNumber(v: any): number { if (isFiniteNumber(v)) return v; const n = typeof v === "string" ? parseFloat(v.trim()) : NaN; return Number.isFinite(n) ? n : NaN; }
const safeNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
function isValidLat(lat: number) { return isFiniteNumber(lat) && lat >= -90 && lat <= 90; }
function isValidLng(lng: number) { return isFiniteNumber(lng) && lng >= -180 && lng <= 180; }
function normalizeCoords(input: any): [number, number] | null {
  if (input == null) return null;
  let a: number | undefined; let b: number | undefined;
  const isArray = Array.isArray(input);
  if (isArray && input.length >= 2) { a = toNumber(input[0]); b = toNumber(input[1]); }
  else if (typeof input === "string") { const cleaned = input.replace(/[()\[\]]/g, ""); const parts = cleaned.split(/\s*,\s*|\s+/).filter(Boolean); if (parts.length >= 2) { a = toNumber(parts[0]); b = toNumber(parts[1]); } }
  else if (typeof input === "object") {
    if ("lat" in input && "lng" in input) { a = toNumber((input as any).lat); b = toNumber((input as any).lng); }
    else if ("latitude" in input && "longitude" in input) { a = toNumber((input as any).latitude); b = toNumber((input as any).longitude); }
  }
  if (isArray) {
    if (isValidLng(a as number) && isValidLat(b as number)) return [a as number, b as number];
    if (isValidLat(a as number) && isValidLng(b as number)) return [b as number, a as number];
  } else {
    if (isValidLat(a as number) && isValidLng(b as number)) return [b as number, a as number];
    if (isValidLng(a as number) && isValidLat(b as number)) return [a as number, b as number];
  }
  // treat near-zero coords as invalid to avoid jumping to the Atlantic/Indian Ocean
  if (a === 0 && b === 0) return null;
  return null;
}

// NEW: handy boolean normaliser
function toBool(v: any): boolean | undefined {
  if (v === true || v === "true" || v === "1" || v === 1) return true;
  if (v === false || v === "false" || v === "0" || v === 0) return false;
  return undefined;
}

// Simple great-circle distance (Haversine) between two [lng, lat] pairs in km
function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius km
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type MapBounds = { north: number; south: number; east: number; west: number };

const boundsChanged = (a: MapBounds, b: MapBounds, threshold = 0.002) =>
  Math.abs(a.north - b.north) > threshold ||
  Math.abs(a.south - b.south) > threshold ||
  Math.abs(a.east - b.east) > threshold ||
  Math.abs(a.west - b.west) > threshold;

/**
 * Placeholder commute approximation.
 * Replace with a routing API later.
 * @returns { distanceKm, driveMinutes }
 */
function computeApproxCommute(
  listingCoords: [number, number] | null,
  airportCoords: [number, number] | null
): { distanceKm: number | null; driveMinutes: number | null } {
  if (!listingCoords || !airportCoords) return { distanceKm: null, driveMinutes: null };
  const distanceKm = haversineKm(listingCoords, airportCoords);
  const avgSpeedKmh = 40; // rough urban average; swap with real routing later
  const driveMinutes = Math.round((distanceKm / avgSpeedKmh) * 60);
  return { distanceKm, driveMinutes };
}

function formatSearchLocation(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes("·")) return trimmed;
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const cleaned = parts.filter((part) => {
    if (/\d/.test(part)) return false;
    if (/united kingdom|england|scotland|wales|northern ireland|uk/i.test(part)) return false;
    return true;
  });
  if (cleaned.length >= 2) return `${cleaned[0]} · ${cleaned[1]}`;
  if (cleaned.length === 1) return cleaned[0];
  if (parts.length >= 2) return `${parts[0]} · ${parts[1]}`;
  return parts[0] ?? "";
}

// ---------------- Local listing shape ----------------
type SearchListing = {
  id: string;
  title: string;
  maxGuests: number;
  airportCode?: string;
  location?: string;
  locationRaw?: string;
  coords?: [number, number];
  coordsMissing?: boolean;
  type?: "private_room" | "shared_room" | "entire_place";
  bedrooms?: number | null;
  beds?: number | null;
  bathrooms?: number | null;
  pricePerNight?: number;
  pricePerHour?: number;
  booking_unit?: "nightly" | "hourly" | null;
  thumbnail?: string;
  distanceKmToAirport: number | null;
  driveMinutesToAirport: number | null;
  travelMinutesMin?: number | null;
  travelMinutesMax?: number | null;
  travelMode?: string | null;
  isSharedBookingAllowed?: boolean;
  quietForRest?: boolean | null;
  blackoutBlinds?: boolean | null;
  access24_7?: boolean | null;
  publicTransportMin?: number | null;
  publicTransportMax?: number | null;
  taxiMin?: number | null;
  taxiMax?: number | null;
  freeCancellation?: boolean | null;
  reviewOverall?: number | null;
  reviewTotal?: number | null;
};

export default function SearchPage() {
  const { query, replace } = useRouter();
  const [listings, setListings] = useState<SearchListing[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [boundsFilter, setBoundsFilter] = useState<MapBounds | null>(null);
  const [pendingBounds, setPendingBounds] = useState<MapBounds | null>(null);
  const [lastSearchBounds, setLastSearchBounds] = useState<MapBounds | null>(null);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [autoFitPins, setAutoFitPins] = useState(true);

  // NEW: refs to enable smooth scrolling to the selected card
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // Parse URL query
  const q = useMemo(() => {
    const get = (k: string) => (typeof query[k] === "string" ? (query[k] as string) : "");
    return {
      location: get("location"),
      checkIn: get("checkIn"),
      checkOut: get("checkOut"),
      checkInTime: get("checkInTime"),
      checkOutTime: get("checkOutTime"),
      bookingUnit: get("bookingUnit") || get("booking_unit"),
      adults: get("adults"),
      children: get("children"),
      infants: get("infants"),
      pets: get("pets"),
      guests: get("guests"),
      priceMin: get("priceMin"),
      priceMax: get("priceMax"),
      roomType: get("roomType"),
      maxDistanceKm: get("maxDistanceKm"),
      airport: get("airport"),

      // NEW: extended filters
      bedrooms: get("bedrooms"),
      beds: get("beds"),
      bathrooms: get("bathrooms"),
      has_wifi: get("has_wifi"),
      has_kitchen: get("has_kitchen"),
      has_desk: get("has_desk"),
      has_shower: get("has_shower"),
      has_bathtub: get("has_bathtub"),
      has_closet: get("has_closet"),
      has_microwave: get("has_microwave"),
      has_coffee_maker: get("has_coffee_maker"),
      has_fridge: get("has_fridge"),
      is_shared_booking_allowed: get("is_shared_booking_allowed"),
      commute_max: get("commute_max"),
      blackout: get("blackout"),
      quiet: get("quiet"),
      access_24_7: get("access_24_7"),
      sort: get("sort"),
    };
  }, [query]);

  const buildDraftFilters = useCallback(
    (current: typeof q) => ({
      bookingUnit: current.bookingUnit || "",
      priceMin: current.priceMin || "",
      priceMax: current.priceMax || "",
      roomType: current.roomType || "",
      quiet: toBool(current.quiet) ?? false,
      blackout: toBool(current.blackout) ?? false,
      access: toBool(current.access_24_7) ?? false,
      commuteMax: current.commute_max || "",
    }),
    []
  );

  const [draftFilters, setDraftFilters] = useState(() => buildDraftFilters(q));

  useEffect(() => {
    setDraftFilters(buildDraftFilters(q));
  }, [q, buildDraftFilters]);

  const airportCode = useMemo(() => {
    const direct = ((q.airport || (q as any).airport_code || "") as string)
      .trim()
      .toUpperCase();
    if (direct && airportCoords[direct as keyof typeof airportCoords]) return direct;
    const loc = ((q.location || "") as string).toUpperCase();
    const match = loc.match(/\b([A-Z]{3})\b/);
    if (match && airportCoords[match[1] as keyof typeof airportCoords]) return match[1];
    return "";
  }, [q]);
  const airportLabel = useMemo(() => {
    const match = AIRPORT_OPTIONS.find((option) => option.code === airportCode);
    return match ? `${match.label} (${match.code})` : airportCode;
  }, [airportCode]);
  const airportName = useMemo(() => {
    const match = AIRPORT_OPTIONS.find((option) => option.code === airportCode);
    return match?.label ?? airportCode;
  }, [airportCode]);
  const priceUnit = q.bookingUnit === "hourly" ? "hour" : "night";
  const activeFilterCount = useMemo(() => {
    const flags = [
      q.bookingUnit,
      q.priceMin,
      q.priceMax,
      q.roomType,
      q.quiet,
      q.blackout,
      q.access_24_7,
      q.commute_max,
    ];
    return flags.filter((value) => value !== undefined && value !== "" && value !== false).length;
  }, [q]);

  const emptyModeLabel = useMemo(() => {
    if (q.bookingUnit === "hourly") return "hourly";
    if (q.bookingUnit === "nightly") return "overnight";
    return null;
  }, [q.bookingUnit]);
  const selectedAirportCoords =
    airportCode && airportCoords[airportCode as keyof typeof airportCoords]
      ? airportCoords[airportCode as keyof typeof airportCoords]
      : null;
  const defaultAirportOption = useMemo(
    () => AIRPORT_OPTIONS.find((option) => option.code === DEFAULT_AIRPORT) ?? AIRPORT_OPTIONS[0],
    []
  );

  const stayWindow = useMemo(() => {
    if (!q.checkIn || !q.checkOut) return null;
    const start = new Date(q.checkIn);
    const end = new Date(q.checkOut);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (q.checkInTime) {
      const [h, m] = q.checkInTime.split(":").map(Number);
      if (Number.isFinite(h)) start.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
    }
    if (q.checkOutTime) {
      const [h, m] = q.checkOutTime.split(":").map(Number);
      if (Number.isFinite(h)) end.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
    }
    const durationMs = end.getTime() - start.getTime();
    if (durationMs <= 0) return null;
    return { durationMs };
  }, [q.checkIn, q.checkOut, q.checkInTime, q.checkOutTime]);

  const stayNights = useMemo(() => {
    if (!stayWindow) return 0;
    const diffDays = stayWindow.durationMs / (1000 * 60 * 60 * 24);
    return Math.max(1, Math.ceil(diffDays));
  }, [stayWindow]);

  const stayHours = useMemo(() => {
    if (!stayWindow) return 0;
    const diffHours = stayWindow.durationMs / (1000 * 60 * 60);
    return Math.max(0.5, Math.ceil(diffHours * 2) / 2);
  }, [stayWindow]);

  const hasTimeSelection = Boolean(q.checkInTime || q.checkOutTime);
  const draftPriceUnit = draftFilters.bookingUnit === "hourly" ? "hour" : "night";
  const initialGuests = useMemo(() => {
    if (q.guests) {
      try {
        const parsed = JSON.parse(q.guests);
        return {
          adults: Number(parsed?.adults ?? 0),
          children: Number(parsed?.children ?? 0),
          infants: Number(parsed?.infants ?? 0),
          pets: Number(parsed?.pets ?? 0),
        };
      } catch {
        return undefined;
      }
    }
    return {
      adults: Number(q.adults || 0),
      children: Number(q.children || 0),
      infants: Number(q.infants || 0),
      pets: Number(q.pets || 0),
    };
  }, [q]);

  const priceHistogram = useMemo(() => {
    const unit = draftFilters.bookingUnit
      ? draftFilters.bookingUnit
      : q.bookingUnit === "hourly"
      ? "hourly"
      : "nightly";
    const values = listings
      .map((listing) => {
        const value =
          unit === "hourly"
            ? listing.pricePerHour ?? null
            : listing.pricePerNight ?? null;
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      })
      .filter((value): value is number => value !== null && value > 0);

    if (!values.length) {
      return { min: 0, max: 0, bins: [] as number[], maxCount: 0 };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const binCount = 24;
    const span = max - min;
    const binSize = span > 0 ? span / binCount : 1;
    const bins = Array.from({ length: binCount }, () => 0);

    values.forEach((value) => {
      const idx = Math.min(binCount - 1, Math.floor((value - min) / binSize));
      bins[idx] += 1;
    });

    const maxCount = Math.max(...bins);
    return { min, max, bins, maxCount };
  }, [draftFilters.bookingUnit, listings, q.bookingUnit]);

  const priceSliderMin = Math.floor(priceHistogram.min / 10) * 10 || 0;
  const priceSliderMax = Math.ceil(priceHistogram.max / 10) * 10 || 500;
  const priceStep = 5;
  const priceMinValue = Math.max(
    priceSliderMin,
    Math.min(Number(draftFilters.priceMin || priceSliderMin), priceSliderMax - priceStep)
  );
  const priceMaxValue = Math.min(
    priceSliderMax,
    Math.max(Number(draftFilters.priceMax || priceSliderMax), priceSliderMin + priceStep)
  );

  // Fetch from Supabase when filters change
  useEffect(() => {
    const locRaw = (q.location || "").trim();
    const locLower = locRaw.toLowerCase();
    const isTrivialLocation = locLower === "nearby" || locLower === "around me" || locLower === "";

    const priceMin = Number(q.priceMin || 0);
    const priceMax = Number(q.priceMax || 999999);
    const bookingUnit = (q.bookingUnit || "").toLowerCase();
    const priceColumn = bookingUnit === "hourly" ? "price_per_hour" : "price_per_night";
    const roomType = (q.roomType || "").trim();
    let guests = Number(q.adults || 0) + Number(q.children || 0);
    if (!guests && q.guests) {
      try {
        const parsed = JSON.parse(q.guests);
        guests = Number(parsed?.total || parsed?.adults || 0);
      } catch (err) {
        if (__DEV__) console.warn("[search] invalid guests payload", err);
      }
    }
    if (!guests) guests = 1;

    const typeMap: Record<string, SearchListing["type"]> = {
      private: "private_room",
      shared: "shared_room",
      entire: "entire_place",
    } as const;
    const wantedType = (roomType && typeMap[roomType]) || undefined;
    const airportFilter = (q.airport || "").trim().toUpperCase();
    const effectiveAirport = (airportCode || airportFilter).trim().toUpperCase();

    const fetchListings = async () => {
      try {
        if (!airportCode) {
          setListings([]);
          return;
        }

        let queryBuilder = supabase.from("listings").select("*");

        if (effectiveAirport) queryBuilder = queryBuilder.eq("airport_code", effectiveAirport);
        if (boundsFilter) {
          queryBuilder = queryBuilder
            .gte("latitude", boundsFilter.south)
            .lte("latitude", boundsFilter.north)
            .gte("longitude", boundsFilter.west)
            .lte("longitude", boundsFilter.east);
        }
        if (wantedType) queryBuilder = queryBuilder.eq("type", wantedType);
        if (!isNaN(priceMin)) queryBuilder = queryBuilder.gte(priceColumn, priceMin);
        if (!isNaN(priceMax)) queryBuilder = queryBuilder.lte(priceColumn, priceMax);
        if (bookingUnit === "hourly" || bookingUnit === "nightly") {
          queryBuilder = queryBuilder.eq("booking_unit", bookingUnit);
        }
        if (guests > 1) queryBuilder = queryBuilder.gte("max_guests", guests);

        // NEW: capacity
        if (!isNaN(Number(q.bedrooms)) && Number(q.bedrooms) > 0) queryBuilder = queryBuilder.gte("bedrooms", Number(q.bedrooms));
        if (!isNaN(Number(q.beds)) && Number(q.beds) > 0) queryBuilder = queryBuilder.gte("beds", Number(q.beds));
        if (!isNaN(Number(q.bathrooms)) && Number(q.bathrooms) > 0) queryBuilder = queryBuilder.gte("bathrooms", Number(q.bathrooms));

        // NEW: amenities (only constrain when explicitly true)
        ([
          "has_wifi",
          "has_kitchen",
          "has_desk",
          "has_shower",
          "has_bathtub",
          "has_closet",
          "has_microwave",
          "has_coffee_maker",
          "has_fridge",
        ] as const).forEach((field) => {
          const val = toBool((q as any)[field]);
          if (val === true) queryBuilder = queryBuilder.eq(field, true);
        });

        // NEW: shared booking toggle
        if (toBool(q.is_shared_booking_allowed) === true) {
          queryBuilder = queryBuilder.eq("is_shared_booking_allowed", true);
        }

        const commuteMax = q.commute_max ? Number(q.commute_max) : NaN;
        if (!Number.isNaN(commuteMax)) {
          queryBuilder = queryBuilder.lte("drive_minutes_offpeak", commuteMax);
        }

        // Crew rest flags
        if (toBool(q.blackout) === true) queryBuilder = queryBuilder.eq("blackout_blinds", true);
        if (toBool(q.quiet) === true) queryBuilder = queryBuilder.eq("quiet_for_rest", true);
        if (toBool(q.access_24_7) === true) queryBuilder = queryBuilder.eq("access_24_7", true);

        const { data, error } = await queryBuilder;
        if (error) {
          if (__DEV__) console.error("[search] supabase query error", error);
          setListings([]);
          return;
        }

        const normalized: SearchListing[] = (Array.isArray(data) ? data : []).map((l: any) => {
          const id = String(l.id ?? Math.random().toString(36).slice(2));
          const airport_code = (l.airport_code ?? l.airport ?? l.iata) as string | undefined;
          const airportCoordPair =
            airport_code && airportCoords[String(airport_code).toUpperCase()]
              ? airportCoords[String(airport_code).toUpperCase()]
              : null;

          const coordsCandidate =
            l.coords ??
            (l.longitude != null && l.latitude != null ? [l.longitude, l.latitude] : undefined) ??
            (l.lng != null && l.lat != null ? [l.lng, l.lat] : undefined) ??
            l.position ??
            null;

          let coords = normalizeCoords(coordsCandidate);
          // Guard: if coords are wildly far from the airport, discard and fall back to airport
          if (coords && airportCoordPair) {
            const dist = haversineKm(coords, airportCoordPair);
            if (!Number.isFinite(dist) || dist > 5000) {
              coords = null;
            }
          }
          const coordsMissing = !coords;
          if (coordsMissing) {
            console.warn("[search] listing missing coords", {
              id,
              title: l.title ?? l.name ?? "Listing",
              location: l.location ?? l.city ?? null,
            });
          }

          const commute = computeApproxCommute(
            coords || null,
            airportCoordPair
          );

          const travelTypical =
            safeNumber(toNumber((l as any).drive_minutes_offpeak)) ??
            safeNumber(toNumber((l as any).taxi_typical_minutes)) ??
            safeNumber(commute.driveMinutes);
          const travelBuffer =
            safeNumber(toNumber((l as any).drive_minutes_buffer)) ??
            safeNumber(toNumber((l as any).taxi_buffer_minutes)) ??
            null;
          const travelMode = (l as any).transport_mode_typical ?? "taxi";
          const publicTransportMin =
            safeNumber(toNumber((l as any).public_transport_typical_minutes)) ??
            safeNumber(toNumber((l as any).public_transport_duration_minutes)) ??
            null;
          const publicTransportMax =
            safeNumber(toNumber((l as any).public_transport_buffer_minutes)) ?? null;
          const taxiMin =
            safeNumber(toNumber((l as any).taxi_typical_minutes)) ??
            safeNumber(toNumber((l as any).taxi_duration_minutes)) ??
            null;
          const taxiMax = safeNumber(toNumber((l as any).taxi_buffer_minutes)) ?? null;
          const reviewOverall = safeNumber(toNumber((l as any).review_overall));
          const reviewTotal = safeNumber(toNumber((l as any).review_total));

          let thumbnail: string | undefined;
          if (Array.isArray(l.photos) && l.photos.length > 0) thumbnail = l.photos[0];
          else thumbnail = l.thumbnail ?? l.image_url ?? l.imageUrl ?? undefined;

          const toType = (t: any): SearchListing["type"] | undefined => {
            const s = (t || "").toString().toLowerCase();
            if (s.includes("private")) return "private_room";
            if (s.includes("shared")) return "shared_room";
            if (s.includes("entire")) return "entire_place";
            return undefined;
          };

          const locationRaw = l.city ?? l.location ?? "";
          const locationLabel = formatSearchLocation(locationRaw);

          return {
            id,
            title: l.title ?? l.name ?? "Listing",
            maxGuests: Number(l.max_guests ?? 1),
            airportCode: airport_code,
            location: locationLabel,
            locationFallback: locationLabel,
            locationRaw,
            coords: coords || undefined,
            coordsMissing,
            type: toType(l.type ?? l.listing_type ?? l.roomType),
            bedrooms: l.bedrooms ?? null,
            beds: l.beds ?? null,
            bathrooms: l.bathrooms ?? null,
            freeCancellation: Boolean((l as any).free_cancellation),
            pricePerNight: Number(l.price_per_night ?? 0),
            pricePerHour: l.price_per_hour != null ? Number(l.price_per_hour) : undefined,
            booking_unit: (l.booking_unit as SearchListing["booking_unit"]) ?? null,
            thumbnail,
            distanceKmToAirport: commute.distanceKm,
            driveMinutesToAirport: commute.driveMinutes,
            travelMinutesMin: safeNumber(travelTypical),
            travelMinutesMax: safeNumber(travelBuffer),
            travelMode,
            isSharedBookingAllowed: Boolean((l as any).is_shared_booking_allowed),
            quietForRest: Boolean((l as any).quiet_for_rest),
            blackoutBlinds: Boolean((l as any).blackout_blinds),
            access24_7: Boolean((l as any).access_24_7),
            publicTransportMin,
            publicTransportMax,
            taxiMin,
            taxiMax,
            reviewOverall,
            reviewTotal,
          };
        });

        let filtered = normalized;
        if (!isTrivialLocation && !effectiveAirport) {
          const loc = locLower;
          filtered = filtered.filter((l) => {
            const city = ((l.locationRaw ?? l.location) || "").toLowerCase();
            const code = (l.airportCode || "").toLowerCase();
            return city.includes(loc) || code.includes(loc) || (loc.length <= 3 && code === loc);
          });
        }

        // Apply commute filter on computed values too (covers null DB values)
        if (!Number.isNaN(commuteMax)) {
          filtered = filtered.filter(
            (l) => l.driveMinutesToAirport != null && l.driveMinutesToAirport <= commuteMax
          );
        }

        const withCoords = filtered.filter(
          (l) => Array.isArray(l.coords) && isValidLng(l.coords![0]) && isValidLat(l.coords![1])
        );
        if (__DEV__) console.log("[search/supabase] filtered:", filtered.length, "withCoords:", withCoords.length);

        // Optional sort: best for crew (shortest commute, then rest-friendly flags)
        let sorted = filtered;
        if ((q.sort || "").toLowerCase() === "crew") {
          const weight = (l: SearchListing) => {
            const commute = l.driveMinutesToAirport ?? 9999;
            const bonus =
              (toBool((l as any).blackout_blinds) ? -5 : 0) +
              (toBool((l as any).quiet_for_rest) ? -5 : 0) +
              (toBool((l as any).access_24_7) ? -2 : 0);
            return commute + bonus;
          };
          sorted = [...filtered].sort((a, b) => weight(a) - weight(b));
        }

        setListings(sorted);
      } catch (err) {
        if (__DEV__) console.error("[search] fetch failed", err);
        setListings([]);
      }
    };

    fetchListings();
  }, [q, boundsFilter]);

  // Map center (unchanged)
  const center = useMemo(() => {
    if (selectedAirportCoords) {
      return { lng: selectedAirportCoords[0], lat: selectedAirportCoords[1] };
    }
    const first = listings.find((l) => Array.isArray(l.coords));
    if (first && first!.coords) return { lng: first!.coords[0], lat: first!.coords[1] };
    return { lng: -0.1278, lat: 51.5074 };
  }, [listings, selectedAirportCoords]);
  const safeCenter = useMemo(() => (isValidLng(center.lng) && isValidLat(center.lat) ? center : { lng: -0.1278, lat: 51.5074 }), [center]);

  // Update URL helper
  const updateQuery = useCallback((patch: Record<string, string | number | boolean | undefined>) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === "" || v === false) params.delete(k);
      else params.set(k, String(v));
    });
    replace({ pathname: "/search", query: Object.fromEntries(params) }, undefined, { shallow: true });
  }, [replace]);

  const handleAirportSelect = useCallback(
    (code: string) => {
      const match = AIRPORT_OPTIONS.find((option) => option.code === code);
      updateQuery({
        airport: code,
        location: match ? `${match.label} (${match.code})` : code,
      });
    },
    [updateQuery]
  );
  const clearFiltersExceptAirport = useCallback(() => {
    updateQuery({
      roomType: undefined,
      priceMin: undefined,
      priceMax: undefined,
      has_wifi: undefined,
      has_kitchen: undefined,
      has_desk: undefined,
      is_shared_booking_allowed: undefined,
      commute_max: undefined,
      blackout: undefined,
      quiet: undefined,
      access_24_7: undefined,
      sort: undefined,
      bookingUnit: undefined,
    });
  }, [updateQuery]);

  const activeFilters = useMemo(() => {
    const items: Array<{ key: string; label: string; onClear: () => void }> = [];
    if (q.bookingUnit === "hourly") {
      items.push({
        key: "bookingUnit",
        label: "Day-use",
        onClear: () => updateQuery({ bookingUnit: undefined, checkInTime: undefined, checkOutTime: undefined }),
      });
    } else if (q.bookingUnit === "nightly") {
      items.push({
        key: "bookingUnit",
        label: "Overnight",
        onClear: () => updateQuery({ bookingUnit: undefined }),
      });
    }

    if (q.priceMin || q.priceMax) {
      const min = q.priceMin ? `£${q.priceMin}` : "";
      const max = q.priceMax ? `£${q.priceMax}` : "";
      let label = `${min || "£0"}–${max || "∞"} / ${priceUnit}`;
      if (q.priceMin && !q.priceMax) label = `${min}+ / ${priceUnit}`;
      if (!q.priceMin && q.priceMax) label = `Up to ${max} / ${priceUnit}`;
      items.push({
        key: "price",
        label,
        onClear: () => updateQuery({ priceMin: undefined, priceMax: undefined }),
      });
    }

    if (q.roomType) {
      const map: Record<string, string> = {
        entire: "Entire place",
        private: "Private room",
        shared: "Shared room",
      };
      items.push({
        key: "roomType",
        label: map[q.roomType] || q.roomType,
        onClear: () => updateQuery({ roomType: undefined }),
      });
    }

    if (toBool(q.quiet) === true) {
      items.push({
        key: "quiet",
        label: "Low-noise environment",
        onClear: () => updateQuery({ quiet: undefined }),
      });
    }
    if (toBool(q.blackout) === true) {
      items.push({
        key: "blackout",
        label: "Blackout blinds",
        onClear: () => updateQuery({ blackout: undefined }),
      });
    }
    if (toBool(q.access_24_7) === true) {
      items.push({
        key: "access",
        label: "24/7 access",
        onClear: () => updateQuery({ access_24_7: undefined }),
      });
    }
    if (q.commute_max) {
      items.push({
        key: "commute",
        label: `Max ${q.commute_max} min`,
        onClear: () => updateQuery({ commute_max: undefined }),
      });
    }
    return items;
  }, [q, priceUnit, updateQuery]);

  const handleBoundsChange = useCallback(
    (bounds: MapBounds) => {
      setPendingBounds(bounds);
      if (!lastSearchBounds) {
        setLastSearchBounds(bounds);
        return;
      }
      if (boundsChanged(bounds, lastSearchBounds)) {
        setShowSearchArea(true);
      }
    },
    [lastSearchBounds]
  );

  const clearDraftFilters = useCallback(() => {
    setDraftFilters({
      bookingUnit: "",
      priceMin: "",
      priceMax: "",
      roomType: "",
      quiet: false,
      blackout: false,
      access: false,
      commuteMax: "",
    });
  }, []);

  const applyDraftFilters = useCallback(() => {
    updateQuery({
      bookingUnit: draftFilters.bookingUnit || undefined,
      priceMin: draftFilters.priceMin || undefined,
      priceMax: draftFilters.priceMax || undefined,
      roomType: draftFilters.roomType || undefined,
      quiet: draftFilters.quiet || undefined,
      blackout: draftFilters.blackout || undefined,
      access_24_7: draftFilters.access || undefined,
      commute_max: draftFilters.commuteMax || undefined,
    });
    setBoundsFilter(null);
    setAutoFitPins(true);
    setShowSearchArea(false);
    setFilterOpen(false);
  }, [draftFilters, updateQuery]);

  // NEW: when a pin selects an item, scroll its card into view
  useEffect(() => {
    if (!activeId) return;
    const el = cardRefs.current[activeId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }, [activeId]);

  useEffect(() => {
    if (!pendingBounds) return;
    if (autoFitPins) {
      setLastSearchBounds(pendingBounds);
      setShowSearchArea(false);
    }
  }, [pendingBounds, autoFitPins, listings.length]);

  useEffect(() => {
    if (!airportCode) return;
    setBoundsFilter(null);
    setAutoFitPins(true);
    setShowSearchArea(false);
  }, [airportCode]);

  if (__DEV__) console.log("[search] listings count:", listings.length, "center:", safeCenter);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="w-full px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="w-full max-w-[820px]">
              <SearchBar
                align="left"
                onSearch={() => undefined}
                initialQuery={{
                  location: q.location,
                  checkIn: q.checkIn,
                  checkOut: q.checkOut,
                  checkInTime: q.checkInTime,
                  checkOutTime: q.checkOutTime,
                  bookingUnit:
                    q.bookingUnit === "hourly"
                      ? "hourly"
                      : q.bookingUnit === "nightly"
                      ? "nightly"
                      : undefined,
                  guests: initialGuests,
                }}
              />
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:border-slate-500"
              >
                Filters
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-[#FEDD02] px-2 py-0.5 text-xs font-semibold text-black">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {activeFilters.length > 0 && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {activeFilters.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={filter.onClear}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
                    >
                      {filter.label}
                      <span className="text-slate-400">×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearFiltersExceptAirport}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[44%_56%]">
        <section className="flex min-h-0 flex-col border-r border-slate-200">
          <div ref={resultsRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {airportCode && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span className="font-semibold">{listings.length}</span> verified stays near{" "}
                <span className="font-mono tabular-nums">{airportCode}</span>. All listings meet
                enforced booking rules.
              </div>
            )}
            {!airportCode && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <div className="text-base font-semibold text-slate-900">Select an airport</div>
                <p className="mt-1 text-sm text-[#4B5563]">
                  Search by hub so travel-time + availability stays accurate.
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {POPULAR_AIRPORTS.map((code) => {
                    const option = AIRPORT_OPTIONS.find((item) => item.code === code);
                    return (
                      <button
                        key={`grid-${code}`}
                        type="button"
                        onClick={() => handleAirportSelect(code)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:border-slate-400"
                      >
                        <span className="block text-[10px] uppercase tracking-[0.2em] text-slate-400">
                          {code}
                        </span>
                        <span className="mt-1 block text-sm font-medium text-slate-800">
                          {option?.label ?? code}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {airportCode && listings.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <div className="text-base font-semibold text-slate-900">
                  {emptyModeLabel
                    ? `No ${emptyModeLabel} listings near ${airportCode}.`
                    : `No Avyro stays match your filters near ${airportCode}.`}
                </div>
                <p className="mt-1 text-sm text-[#4B5563]">
                  {emptyModeLabel
                    ? "Try switching stay mode or relaxing one filter."
                    : "Try removing one filter or increasing your maximum commute time."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {emptyModeLabel && (
                    <button
                      onClick={() =>
                        updateQuery({
                          bookingUnit: emptyModeLabel === "hourly" ? "nightly" : "hourly",
                          checkInTime: emptyModeLabel === "hourly" ? undefined : q.checkInTime,
                          checkOutTime: emptyModeLabel === "hourly" ? undefined : q.checkOutTime,
                        })
                      }
                      className="rounded-full border border-slate-300 px-3 py-2 text-sm font-medium hover:border-slate-500"
                    >
                      Switch to {emptyModeLabel === "hourly" ? "Overnight" : "Day-use"}
                    </button>
                  )}
                  <button
                    onClick={clearFiltersExceptAirport}
                    className="rounded-full border border-slate-300 px-3 py-2 text-sm font-medium hover:border-slate-500"
                  >
                    Clear filters
                  </button>
                  <button
                    onClick={() => updateQuery({ commute_max: 30 })}
                    className="rounded-full border border-slate-300 px-3 py-2 text-sm font-medium hover:border-slate-500"
                  >
                    Increase commute limit
                  </button>
                </div>
              </div>
            )}

            {airportCode &&
              listings.length > 0 &&
              listings.map((listing) => (
                <div
                  key={listing.id}
                  ref={(el) => {
                    cardRefs.current[listing.id] = el || undefined;
                  }}
                >
                  <MapListingCard
                    listing={listing}
                    staySummary={
                      listing.booking_unit === "hourly"
                        ? hasTimeSelection && stayHours > 0
                          ? { units: stayHours, unitLabel: "hour" }
                          : null
                        : stayNights > 0
                        ? { units: stayNights, unitLabel: "night" }
                        : null
                    }
                    active={hoverId === listing.id || activeId === listing.id}
                    onHover={() => setHoverId(listing.id)}
                    onLeave={() => setHoverId(null)}
                    onSelect={() => setActiveId(listing.id)}
                  />
                </div>
              ))}
          </div>
        </section>

        <section className="relative hidden min-h-0 lg:block">
          <div className="h-full">
            {!airportCode ? (
              <div className="relative h-full w-full">
                <MapView
                  mapboxAccessToken={MAPBOX_TOKEN}
                  mapStyle="mapbox://styles/mapbox/navigation-day-v1"
                  longitude={
                    airportCoords[defaultAirportOption.code]
                      ? airportCoords[defaultAirportOption.code][0]
                      : safeCenter.lng
                  }
                  latitude={
                    airportCoords[defaultAirportOption.code]
                      ? airportCoords[defaultAirportOption.code][1]
                      : safeCenter.lat
                  }
                  zoom={11}
                  style={{ width: "100%", height: "100%" }}
                  className="h-full"
                  listings={[]}
                  airportCode={defaultAirportOption.code}
                  airportLabel={defaultAirportOption.label}
                  airportCoords={airportCoords[defaultAirportOption.code] as any}
                  showAirportLabel={false}
                />
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 translate-y-6 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
                  Select dates to see available stays.
                </div>
              </div>
            ) : (
              <div className="h-full w-full">
                <MapView
                  mapboxAccessToken={MAPBOX_TOKEN}
                  mapStyle="mapbox://styles/mapbox/navigation-day-v1"
                  longitude={safeCenter.lng}
                  latitude={safeCenter.lat}
                  zoom={11}
                  style={{ width: "100%", height: "100%" }}
                  className="h-full"
                  listings={listings}
                  hoverId={hoverId}
                  activeId={activeId}
                  onHover={setHoverId}
                  onSelect={setActiveId}
                  onBoundsChange={handleBoundsChange}
                  fitToPins={autoFitPins}
                  airportCode={airportCode}
                  airportLabel={airportName}
                  airportCoords={selectedAirportCoords as any}
                />
                {showSearchArea && pendingBounds && (
                  <button
                    type="button"
                    onClick={() => {
                      setBoundsFilter(pendingBounds);
                      setLastSearchBounds(pendingBounds);
                      setShowSearchArea(false);
                      setAutoFitPins(false);
                    }}
                    className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-md"
                  >
                    Search this area
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {filterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
              <button
                type="button"
                onClick={clearDraftFilters}
                className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500"
              >
                Clear
              </button>
            </div>
            <div className="max-h-[70vh] space-y-6 overflow-y-auto px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Stay type
                </p>
                <div className="mt-3 flex gap-2">
                  {[
                    { value: "nightly", label: "Overnight" },
                    { value: "hourly", label: "Day-use" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          bookingUnit: prev.bookingUnit === option.value ? "" : option.value,
                        }))
                      }
                      className={`flex-1 rounded-xl border px-4 py-2 text-sm font-medium ${
                        draftFilters.bookingUnit === option.value
                          ? "border-[#FEDD02] bg-[#FEDD02] text-black"
                          : "border-slate-200 text-slate-700 hover:border-slate-400"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Price range
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs text-slate-500">
                    <span>Min (£/{draftPriceUnit})</span>
                    <input
                      type="number"
                      placeholder="0"
                      value={draftFilters.priceMin}
                      onChange={(e) =>
                        setDraftFilters((prev) => ({ ...prev, priceMin: e.target.value }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-500">
                    <span>Max (£/{draftPriceUnit})</span>
                    <input
                      type="number"
                      placeholder="200"
                      value={draftFilters.priceMax}
                      onChange={(e) =>
                        setDraftFilters((prev) => ({ ...prev, priceMax: e.target.value }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                </div>
                <div className="mt-4">
                  <div className="relative h-16">
                    <div className="absolute inset-0 flex items-end gap-1">
                      {priceHistogram.bins.map((count, idx) => {
                        const height =
                          priceHistogram.maxCount > 0
                            ? Math.max(6, Math.round((count / priceHistogram.maxCount) * 60))
                            : 6;
                        return (
                          <span
                            key={`bin-${idx}`}
                            className="flex-1 rounded-full bg-slate-200"
                            style={{ height }}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className="relative mt-3">
                    <input
                      type="range"
                      min={priceSliderMin}
                      max={priceSliderMax}
                      step={priceStep}
                      value={priceMinValue}
                      onChange={(e) => {
                        const next = Math.min(Number(e.target.value), priceMaxValue - priceStep);
                        setDraftFilters((prev) => ({ ...prev, priceMin: String(next) }));
                      }}
                      className="w-full accent-[#FEDD02]"
                    />
                    <input
                      type="range"
                      min={priceSliderMin}
                      max={priceSliderMax}
                      step={priceStep}
                      value={priceMaxValue}
                      onChange={(e) => {
                        const next = Math.max(Number(e.target.value), priceMinValue + priceStep);
                        setDraftFilters((prev) => ({ ...prev, priceMax: String(next) }));
                      }}
                      className="mt-2 w-full accent-[#FEDD02]"
                    />
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span>£{priceSliderMin}</span>
                      <span>£{priceSliderMax}+</span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Room type
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { value: "entire", label: "Entire place" },
                    { value: "private", label: "Private room" },
                    { value: "shared", label: "Shared room" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          roomType: prev.roomType === option.value ? "" : option.value,
                        }))
                      }
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        draftFilters.roomType === option.value
                          ? "border-[#FEDD02] bg-[#FEDD02] text-black"
                          : "border-slate-200 text-slate-700 hover:border-slate-400"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                {[
                  {
                    key: "quiet",
                    label: "Low-noise environment",
                    helper: "Best for rest and shift recovery.",
                  },
                  {
                    key: "blackout",
                    label: "Blackout blinds",
                    helper: "Light control for day sleepers.",
                  },
                  {
                    key: "access",
                    label: "24/7 access",
                    helper: "Late arrivals and early departures.",
                  },
                ].map((option) => (
                  <label key={option.key} className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={(draftFilters as any)[option.key]}
                      onChange={(e) =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          [option.key]: e.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-[#FEDD02] focus:ring-[#FEDD02]"
                    />
                    <span>
                      <span className="block font-medium text-slate-800">{option.label}</span>
                      <span className="block text-xs text-slate-500">{option.helper}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Max minutes to airport — {draftFilters.commuteMax || 30} min
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="range"
                    min={5}
                    max={60}
                    step={5}
                    value={draftFilters.commuteMax || 30}
                    onChange={(e) =>
                      setDraftFilters((prev) => ({ ...prev, commuteMax: e.target.value }))
                    }
                    className="flex-1 accent-[#FEDD02]"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyDraftFilters}
                className="rounded-full bg-[#FEDD02] px-5 py-2 text-sm font-semibold text-black"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
