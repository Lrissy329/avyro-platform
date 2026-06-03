import { useState, useEffect, useMemo } from "react";
import AeronoocMap from "@/components/map";
import { AMENITY_SCHEMA, type AmenitySchema, getAmenityIcon } from "@/lib/amenities";
import { computeSharedPerPersonWeeklyPricePence } from "@/lib/pricing";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2,
  Camera,
  DoorOpen,
  Home,
  House,
  Minus,
  Moon,
  Plus,
  Repeat2,
  Sailboat,
  Users,
} from "lucide-react";

type PriceOverrideInput = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  price: string;
};

type HostQuote = {
  currency: "GBP";
  host_net_nightly_pence: number;
  guest_unit_price_pence: number;
  raw_guest_unit_price_pence: number;
  rounding_adjustment_pence: number;
  platform_fee_est_pence: number;
  platform_fee_capped: boolean;
  stripe_fee_est_pence: number;
  platform_margin_est_pence: number;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: "all_in_v2_tiers_cap_firstfree";
};

const PLACE_TYPES = [
  { value: "house", label: "House", icon: Home },
  { value: "flat", label: "Flat/apartment", icon: Building2 },
  { value: "guest_house", label: "Guest house", icon: House },
  { value: "cabin", label: "Cabin", icon: House },
  { value: "boat", label: "Boat", icon: Sailboat },
];

const ROOM_TYPES = [
  { value: "entire place", label: "An entire place", description: "Guests have the whole place to themselves.", icon: Home },
  { value: "private room", label: "A room", description: "Guests have their own room in a home.", icon: DoorOpen },
];

const LISTING_MODEL_OPTIONS = [
  {
    value: "standard",
    label: "Standard stay",
    description: "Traditional overnight stays booked per night.",
    icon: Moon,
    rentalType: "overnight_stay",
    bookingUnit: "nightly" as const,
    enableFlex: false,
    enableShared: false,
  },
  {
    value: "flexible",
    label: "Flexible stay",
    description: "Overnight stays with optional extra-night flexibility.",
    icon: Repeat2,
    rentalType: "overnight_stay",
    bookingUnit: "nightly" as const,
    enableFlex: true,
    enableShared: false,
  },
  {
    value: "shared",
    label: "Shared stay",
    description: "Professionals book individual spots in the property.",
    icon: Users,
    rentalType: "overnight_stay",
    bookingUnit: "nightly" as const,
    enableFlex: false,
    enableShared: true,
  },
] as const;

const RENTAL_TYPE_CONFIG: Record<
  string,
  { bookingUnit: "nightly" | "hourly"; amenityExclusions: string[] }
> = {
  overnight_stay: { bookingUnit: "nightly", amenityExclusions: [] },
  crashpad: { bookingUnit: "nightly", amenityExclusions: [] },
  day_use: { bookingUnit: "hourly", amenityExclusions: ["laundry", "kitchen_access"] },
  split_rest: { bookingUnit: "hourly", amenityExclusions: ["laundry", "kitchen_access"] },
};

const BOOKING_UNIT_COPY: Record<
  "nightly" | "hourly",
  { label: string; description: string; note: string }
> = {
  nightly: {
    label: "Nightly stays",
    description: "Guests book by the night with check-in and checkout dates.",
    note: "Calendar and pricing are optimized for overnight stays.",
  },
  hourly: {
    label: "Hourly stays",
    description: "Guests book in hours for a specific day and time window.",
    note: "Calendar and pricing are optimized for time-based stays.",
  },
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const PRICE_FIELDS = new Set(["price_per_night", "price_per_hour", "price_per_week", "price_per_month"]);
const NIGHTLY_RATE_MIN = 20;
const NIGHTLY_RATE_MAX = 1000;
const isMissingListingColumnError = (error: any) => {
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const code = error?.code;
  const combined = `${message} ${details}`;

  return (
    code === "42703" ||
    code === "PGRST204" ||
    ((combined.includes("column") || combined.includes("schema cache")) &&
      (combined.includes("does not exist") || combined.includes("could not find")))
  );
};

const extractMissingListingColumns = (error: any): string[] => {
  const candidates = [
    String(error?.message ?? ""),
    String(error?.details ?? ""),
    String(error?.hint ?? ""),
  ];
  const columns = new Set<string>();
  const patterns = [
    /could not find the ['"`]([a-z0-9_]+)['"`] column of ['"`]listings['"`] in the schema cache/gi,
    /column\s+listings\.([a-z0-9_]+)\s+does not exist/gi,
    /column\s+["'`]?([a-z0-9_]+)["'`]?\s+does not exist/gi,
  ];

  for (const text of candidates) {
    for (const pattern of patterns) {
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match) {
        if (match[1]) columns.add(String(match[1]).toLowerCase());
        match = pattern.exec(text);
      }
      pattern.lastIndex = 0;
    }
  }

  return Array.from(columns);
};

const formatGBPFromPence = (pence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pence / 100);

type GeoSuggestion = {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
};

export default function CreateListing() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const TOTAL_STEPS = 10;
  const LAST_STEP_INDEX = TOTAL_STEPS - 1;
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [formData, setFormData] = useState({
    stay_model: "standard",
    place_type: "house",
    type: "entire place",
    rental_type: "overnight_stay",
    booking_unit: "nightly",
    title: "",
    description: "",
    airport_code: "",
    location: "",
    price_per_night: "",
    price_per_hour: "",
    price_per_week: "",
    price_per_month: "",
    price_overrides: [] as PriceOverrideInput[],
    guests: 1,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    latitude: 51.5074,
    longitude: -0.1278,
    amenities: [] as string[],
    allow_flexible_stays: false,
    flexible_stay_mode: "none",
    flex_min_commitment_nights: 7,
    flex_max_extension_nights: 7,
    flex_extension_notice_hours: 24,
    flex_extension_pricing_mode: "same_rate",
    flex_rolling_window_days: 3,
    flex_pricing_multiplier: 1.1,
    is_shared_stay: false,
    shared_total_spots: 4,
    shared_weekly_price_gbp: "",
    shared_join_mode: "open",
    shared_min_weeks: 1,
    shared_max_weeks: 12,
  });
  const selectedListingModelConfig = useMemo(() => {
    return (
      LISTING_MODEL_OPTIONS.find((option) => option.value === formData.stay_model) ??
      LISTING_MODEL_OPTIONS[0]
    );
  }, [formData.stay_model]);
  const [hostQuote, setHostQuote] = useState<HostQuote | null>(null);
  const [hostQuoteLoading, setHostQuoteLoading] = useState(false);
  const [hostQuoteError, setHostQuoteError] = useState<string | null>(null);

  const rentalTypeConfig = useMemo(() => {
    return (
      RENTAL_TYPE_CONFIG[formData.rental_type] ??
      RENTAL_TYPE_CONFIG.overnight_stay
    );
  }, [formData.rental_type]);

  const bookingUnitCopy = BOOKING_UNIT_COPY[rentalTypeConfig.bookingUnit];
  const isHourlyBooking = rentalTypeConfig.bookingUnit === "hourly";
  const sharedWeeklyTotalPenceInput = Math.max(
    0,
    Math.round(Number(formData.shared_weekly_price_gbp || 0) * 100)
  );
  const sharedPerPersonWeeklyPreviewPence = computeSharedPerPersonWeeklyPricePence({
    totalWeeklyPricePence: sharedWeeklyTotalPenceInput,
    totalSpots: Math.max(1, Number(formData.shared_total_spots || 1)),
  }).rounded_per_person_weekly_pence;

  useEffect(() => {
    if (isHourlyBooking) {
      setHostQuote(null);
      setHostQuoteError(null);
      setHostQuoteLoading(false);
      return;
    }

    const raw = formData.price_per_night.trim();
    const nightlyValue = Number(raw);
    if (!raw || !Number.isFinite(nightlyValue) || nightlyValue <= 0 || !Number.isInteger(nightlyValue)) {
      setHostQuote(null);
      setHostQuoteError(null);
      setHostQuoteLoading(false);
      return;
    }

    const hostNetNightlyPence = nightlyValue * 100;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setHostQuoteLoading(true);
      setHostQuoteError(null);
      try {
        const resp = await fetch("/api/pricing/host-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostNetNightlyPence }),
        });
        const payload = await resp.json();
        if (!resp.ok) {
          throw new Error(payload?.error ?? "Failed to fetch pricing quote.");
        }
        if (!cancelled) {
          setHostQuote(payload);
        }
      } catch (err: any) {
        if (!cancelled) {
          setHostQuote(null);
          setHostQuoteError(err?.message ?? "Failed to fetch pricing quote.");
        }
      } finally {
        if (!cancelled) {
          setHostQuoteLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [formData.price_per_night, isHourlyBooking]);

  useEffect(() => {
    const nextBookingUnit = rentalTypeConfig.bookingUnit;
    setFormData((prev) => {
      if (prev.booking_unit === nextBookingUnit) return prev;
      return {
        ...prev,
        booking_unit: nextBookingUnit,
        price_per_week: nextBookingUnit === "hourly" ? "" : prev.price_per_week,
        price_per_month: nextBookingUnit === "hourly" ? "" : prev.price_per_month,
        price_overrides: nextBookingUnit === "hourly" ? [] : prev.price_overrides,
      };
    });
  }, [rentalTypeConfig.bookingUnit]);

  useEffect(() => {
    const excluded = new Set(rentalTypeConfig.amenityExclusions);
    if (!excluded.size) return;
    setFormData((prev) => {
      const current = prev.amenities || [];
      const next = current.filter((code) => !excluded.has(code));
      if (next.length === current.length) return prev;
      return { ...prev, amenities: next };
    });
  }, [rentalTypeConfig.amenityExclusions]);

  // Track photos selected for upload
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);

  // Map & geocoding state (defaults to London center)
  const [addressQuery, setAddressQuery] = useState<string>("");
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [hasCoordinates, setHasCoordinates] = useState(false);

  // Debounce address typing to fetch suggestions automatically
  useEffect(() => {
    if (!MAPBOX_TOKEN) return;
    const trimmed = addressQuery.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      geocodeAddress(trimmed);
    }, 300);
    return () => clearTimeout(t);
  }, [addressQuery]);

  const [airportChoices] = useState([
    { code: "STN", name: "London Stansted" },
    { code: "LTN", name: "London Luton" },
    { code: "LHR", name: "London Heathrow" },
    { code: "LGW", name: "London Gatwick" },
  ]);

  const amenityGroups = useMemo(() => {
    const excluded = new Set(rentalTypeConfig.amenityExclusions);
    const grouped = new Map<string, AmenitySchema[]>();
    AMENITY_SCHEMA.forEach((amenity) => {
      if (excluded.has(amenity.code)) return;
      if (!grouped.has(amenity.group)) grouped.set(amenity.group, []);
      grouped.get(amenity.group)!.push(amenity);
    });
    return Array.from(grouped.entries()).map(([group, items]) => ({
      group,
      items: [...items].sort((a, b) => {
        if (a.required === b.required) return a.label.localeCompare(b.label);
        return a.required ? -1 : 1;
      }),
    }));
  }, [rentalTypeConfig.amenityExclusions]);


  const toggleAmenity = (code: string) => {
    const amenity = AMENITY_SCHEMA.find((item) => item.code === code);
    if (amenity && amenity.editable === false) return;
    setFormData((prev) => {
      const current = prev.amenities || [];
      const exists = current.includes(code);
      const next = exists ? current.filter((item) => item !== code) : [...current, code];
      return { ...prev, amenities: next };
    });
  };

  const selectedAmenities = formData.amenities || [];

  // Error tracking state
  const [errors, setErrors] = useState<{ [key: string]: string | undefined }>({});
  const ENABLE_CREATE_LISTING_DEBUG = process.env.NODE_ENV === "development";

  // Step validation helper
  const validateStep = () => {
    const newErrors: { [key: string]: string } = {};
    const isHourly = formData.booking_unit === "hourly";

    if (step === 0) {
      if (!formData.stay_model) newErrors.stay_model = "Select a stay model.";
    }
    if (step === 3) {
      if (!formData.location) newErrors.location = "Location is required.";
      if (!formData.airport_code) newErrors.airport_code = "Airport code is required.";
      const lat = Number((formData as any).latitude);
      const lng = Number((formData as any).longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !hasCoordinates) {
        newErrors.coordinates = "Select an address to set accurate coordinates.";
      }
    }
    if (step === 4) {
      const guests = Number(formData.guests);
      const beds = Number(formData.beds);
      const bathrooms = Number(formData.bathrooms);
      const bedrooms = Number(formData.bedrooms);
      if (!Number.isFinite(guests) || guests < 1) newErrors.guests = "Guests must be at least 1.";
      if (!Number.isFinite(beds) || beds < 1) newErrors.beds = "Beds must be at least 1.";
      if (!Number.isFinite(bathrooms) || bathrooms < 0) newErrors.bathrooms = "Bathrooms cannot be negative.";
      if (!isHourly && formData.type !== "private room" && (!Number.isFinite(bedrooms) || bedrooms < 0)) {
        newErrors.bedrooms = "Bedrooms cannot be negative.";
      }
    }
    if (step === 6 && photoFiles.length < 5) {
      newErrors.photos = "Upload at least 5 photos.";
    }
    if (step === 7) {
      if (!formData.title) newErrors.title = "Title is required.";
      if (!formData.description) newErrors.description = "Description is required.";
    }
    if (step === 8) {
      const pricingValid = !!parsePricingFields();
      return pricingValid;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };


  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        router.push("/login");
      } else {
        setUserId(user.id);
      }
    };
    getSession();
  }, [router]);

  const geocodeAddress = async (query: string) => {
    try {
      if (!MAPBOX_TOKEN) return;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=gb&limit=5`;
      const res = await fetch(url);
      const data = await res.json();
      const feats = (data.features || []) as any[];
      const mapped: GeoSuggestion[] = feats.map((f) => ({
        id: f.id,
        place_name: f.place_name,
        center: f.center,
      }));
      setSuggestions(mapped);
    } catch (e) {
      console.error("Mapbox geocode failed", e);
    }
  };

  // Reverse geocode helper
  const reverseGeocode = async (lng: number, lat: number) => {
    try {
      if (!MAPBOX_TOKEN) return;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
      const res = await fetch(url);
      const data = await res.json();
      const place = data?.features?.[0]?.place_name as string | undefined;
      if (place) {
        setFormData((prev: any) => ({ ...prev, location: place, latitude: lat, longitude: lng }));
        setAddressQuery(place);
        setHasCoordinates(true);
      }
    } catch (e) {
      console.error("Mapbox reverse geocode failed", e);
    }
  };

  // Handler to get current location and update form/map
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setFormData((prev: any) => ({ ...prev, latitude: lat, longitude: lng }));
        reverseGeocode(lng, lat);
      },
      (err) => {
        console.error('Geolocation error', err);
        alert('Could not get your location. Please allow location access or type your address.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const { name, value, type } = target;
    const checked = (target as HTMLInputElement).checked;
    if (PRICE_FIELDS.has(name)) {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
      // Remove previous error if any
      setErrors((prev) => ({ ...prev, [name]: undefined }));
      return;
    }
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleModelSelect = (modelValue: string) => {
    const selectedModel =
      LISTING_MODEL_OPTIONS.find((option) => option.value === modelValue) ??
      LISTING_MODEL_OPTIONS[0];
    setFormData((prev) => ({
      ...prev,
      stay_model: selectedModel.value,
      rental_type: selectedModel.rentalType,
      booking_unit: selectedModel.bookingUnit,
      allow_flexible_stays: selectedModel.enableFlex,
      is_shared_stay: selectedModel.enableShared,
      flexible_stay_mode: selectedModel.enableFlex ? "extra_night" : "none",
      price_per_hour: "",
      price_per_night: prev.price_per_night,
      price_per_week: prev.price_per_week,
      price_per_month: prev.price_per_month,
      price_overrides: prev.price_overrides,
    }));
    setErrors((prev) => ({ ...prev, stay_model: undefined, rental_type: undefined }));
  };

  const updateCounterField = (
    field: "guests" | "beds" | "bedrooms" | "bathrooms",
    delta: number,
    minValue: number
  ) => {
    setFormData((prev) => {
      const current = Number(prev[field] ?? minValue);
      const next = Math.max(minValue, Math.round(current + delta));
      return { ...prev, [field]: next };
    });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleCardSelect = (name: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };


  const addPriceOverride = () => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setFormData((prev) => ({
      ...prev,
      price_overrides: [
        ...prev.price_overrides,
        { id, label: "", start_date: "", end_date: "", price: "" },
      ],
    }));
  };

  const updatePriceOverride = (
    id: string,
    field: keyof Omit<PriceOverrideInput, "id">,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      price_overrides: prev.price_overrides.map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      ),
    }));
  };

  const removePriceOverride = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      price_overrides: prev.price_overrides.filter((entry) => entry.id !== id),
    }));
  };

  const parsePricingFields = () => {
    const newErrors: Record<string, string | undefined> = {};
    const isHourly = formData.booking_unit === "hourly";
    const isShared = Boolean(formData.is_shared_stay);

    if (isShared) {
      setErrors((prev) => ({
        ...prev,
        price_per_hour: undefined,
        price_per_night: undefined,
        price_per_week: undefined,
        price_per_month: undefined,
        price_overrides: undefined,
      }));
      return {
        nightly: null,
        hourly: null,
        weekly: null,
        monthly: null,
        overrides: [],
      };
    }

    const rateField = isHourly ? "price_per_hour" : "price_per_night";
    const rateStr = isHourly
      ? formData.price_per_hour.trim()
      : formData.price_per_night.trim();
    const rateValue = Number(rateStr);
    if (!rateStr) {
      newErrors[rateField] = isHourly
        ? "Hourly rate is required."
        : "Price is required.";
    } else if (isNaN(rateValue) || rateValue <= 0) {
      newErrors[rateField] = isHourly
        ? "Enter a valid hourly rate."
        : "Enter a valid nightly rate.";
    } else if (!Number.isInteger(rateValue)) {
      newErrors[rateField] = "Use whole pounds (no decimals).";
    }

    if (isHourly) {
      if (Object.keys(newErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...newErrors }));
        return null;
      }

      setErrors((prev) => ({
        ...prev,
        price_per_hour: undefined,
        price_per_night: undefined,
        price_per_week: undefined,
        price_per_month: undefined,
        price_overrides: undefined,
      }));

      return {
        nightly: null,
        hourly: rateValue,
        weekly: null,
        monthly: null,
        overrides: [],
      };
    }

    const parseOptional = (value: string, field: "price_per_week" | "price_per_month") => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      if (isNaN(num) || num <= 0) {
        newErrors[field] = "Enter a positive amount.";
        return null;
      }
      if (!Number.isInteger(num)) {
        newErrors[field] = "Use whole pounds (no decimals).";
        return null;
      }
      return num;
    };

    const weeklyValue = parseOptional(formData.price_per_week, "price_per_week");
    const monthlyValue = parseOptional(formData.price_per_month, "price_per_month");

    let overridesError = "";
    const overrides = formData.price_overrides
      .map((entry) => {
        const hasAny = entry.label || entry.start_date || entry.end_date || entry.price;
        if (!hasAny) return null;
        if (!entry.start_date || !entry.end_date || !entry.price) {
          overridesError = "Custom pricing entries require start date, end date, and price.";
          return null;
        }
        const priceValue = Number(entry.price);
        if (isNaN(priceValue) || priceValue <= 0) {
          overridesError = "Custom pricing must use positive numbers.";
          return null;
        }
        if (!Number.isInteger(priceValue)) {
          overridesError = "Custom pricing must use whole pounds (no decimals).";
          return null;
        }
        return {
          label: entry.label?.trim() || null,
          start_date: entry.start_date,
          end_date: entry.end_date,
          price: priceValue,
        };
      })
      .filter((entry): entry is { label: string | null; start_date: string; end_date: string; price: number } => !!entry);

    if (overridesError) {
      newErrors.price_overrides = overridesError;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...newErrors }));
      return null;
    }

    setErrors((prev) => ({
      ...prev,
      price_per_hour: undefined,
      price_per_night: undefined,
      price_per_week: undefined,
      price_per_month: undefined,
      price_overrides: undefined,
    }));

    return {
      nightly: rateValue,
      hourly: null,
      weekly: weeklyValue,
      monthly: monthlyValue,
      overrides,
    };
  };


  const handlePublish = async (source: string) => {
    if (step !== LAST_STEP_INDEX) return;
    if (!userId || isPublishing) return;

    if (ENABLE_CREATE_LISTING_DEBUG) {
      console.log(
        "CREATE_LISTING_PUBLISH_TRIGGERED\n" +
          JSON.stringify(
            {
              step,
              source,
              timestamp: new Date().toISOString(),
            },
            null,
            2
          )
      );
    }

    setIsPublishing(true);

    try {
      const pricing = parsePricingFields();
      if (!pricing) return;
      if (formData.is_shared_stay) {
        const sharedWeekly = Number(formData.shared_weekly_price_gbp);
        if (!Number.isFinite(sharedWeekly) || sharedWeekly <= 0) {
          alert("Enter a valid total shared weekly price.");
          return;
        }
        if (Number(formData.shared_total_spots) < 1) {
          alert("Shared stay listings need at least one spot.");
          return;
        }
      }
      if (
        !hasCoordinates ||
        !Number.isFinite(Number((formData as any).latitude)) ||
        !Number.isFinite(Number((formData as any).longitude))
      ) {
        alert("Please select an address so we can capture accurate coordinates.");
        return;
      }
      const { nightly, hourly, weekly, monthly, overrides } = pricing;
      const isHourlyBooking = formData.booking_unit === "hourly";
      const amenityCodes = formData.amenities || [];
      const amenityFlags = {
        has_wifi: amenityCodes.includes("wifi"),
        has_desk: amenityCodes.includes("dedicated_workspace"),
        has_kitchen: amenityCodes.includes("kitchen_access"),
        has_microwave: false,
        has_coffee_maker: false,
        has_fridge: amenityCodes.includes("kitchen_access"),
        has_shower: amenityCodes.includes("private_bathroom") || amenityCodes.includes("hot_water"),
        has_bathtub: amenityCodes.includes("private_bathroom"),
        has_closet: amenityCodes.includes("quality_linens"),
      } as const;

      // Upload photos first so we can store them with the insert (avoids update-policy issues)
      if (photoFiles.length < 5) {
        alert("Please upload at least 5 photos.");
        return;
      }

      const uploaded = await Promise.all(
        photoFiles.map(async (file) => {
          const filename = `${userId}/${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
          const { error: upErr } = await supabase.storage
            .from("listing-photos")
            .upload(filename, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: (file as File).type || "image/jpeg",
            });

          if (upErr) {
            console.error("Upload error:", upErr.message);
            return null;
          }

          const { data: pub } = supabase.storage.from("listing-photos").getPublicUrl(filename);
          return pub?.publicUrl ?? null;
        })
      );

      const photoUrls = uploaded.filter(Boolean) as string[];

    // Insert listing with photo URLs (whitelisted DB fields only; exclude UI helper fields)
    const payload = {
      user_id: userId,
      stay_model: formData.stay_model,
      place_type: formData.place_type,
      type: formData.type,
      rental_type: formData.rental_type,
      booking_unit: formData.booking_unit,
      title: formData.title.trim(),
      description: formData.description.trim(),
      airport_code: formData.airport_code.toUpperCase().trim(),
      location: formData.location.trim(),
      latitude: Number(formData.latitude),
      longitude: Number(formData.longitude),
      amenities: amenityCodes,
      ...amenityFlags,
      price_per_night: isHourlyBooking ? null : nightly,
      price_per_hour: isHourlyBooking ? hourly : null,
      price_per_week: isHourlyBooking ? null : weekly,
      price_per_month: isHourlyBooking ? null : monthly,
      price_overrides: isHourlyBooking ? null : overrides.length ? overrides : null,
      guests: Math.max(1, Math.round(Number(formData.guests) || 1)),
      bedrooms: Number.isFinite(Number(formData.bedrooms))
        ? Math.max(0, Math.round(Number(formData.bedrooms)))
        : null,
      beds: Math.max(1, Math.round(Number(formData.beds) || 1)),
      bathrooms: Number.isFinite(Number(formData.bathrooms))
        ? Math.max(0, Math.round(Number(formData.bathrooms)))
        : null,
      photos: photoUrls,
      allow_flexible_stays: Boolean(formData.allow_flexible_stays),
      flexible_stay_mode: formData.allow_flexible_stays ? formData.flexible_stay_mode : "none",
      flex_min_commitment_nights: formData.allow_flexible_stays
        ? Math.max(1, Math.round(Number(formData.flex_min_commitment_nights) || 1))
        : null,
      flex_max_extension_nights: formData.allow_flexible_stays
        ? Math.max(0, Math.round(Number(formData.flex_max_extension_nights) || 0))
        : null,
      flex_extension_notice_hours: formData.allow_flexible_stays
        ? Math.max(1, Math.round(Number(formData.flex_extension_notice_hours) || 24))
        : null,
      flex_extension_pricing_mode: formData.allow_flexible_stays
        ? String(formData.flex_extension_pricing_mode || "same_rate")
        : null,
      flex_rolling_window_days: formData.allow_flexible_stays
        ? Math.max(1, Math.round(Number(formData.flex_rolling_window_days) || 1))
        : null,
      flex_pricing_multiplier: formData.allow_flexible_stays
        ? Math.min(5, Math.max(1, Number(formData.flex_pricing_multiplier) || 1))
        : null,
      is_shared_stay: Boolean(formData.is_shared_stay),
      shared_total_spots: formData.is_shared_stay
        ? Math.max(1, Math.round(Number(formData.shared_total_spots) || 1))
        : null,
      shared_weekly_price_pence: formData.is_shared_stay
        ? Math.max(0, Math.round(Number(formData.shared_weekly_price_gbp) || 0) * 100)
        : null,
      shared_join_mode: formData.is_shared_stay ? "open" : null,
      shared_min_weeks: formData.is_shared_stay
        ? Math.max(1, Math.round(Number(formData.shared_min_weeks) || 1))
        : null,
      shared_max_weeks: formData.is_shared_stay
        ? Math.max(
            Math.max(1, Math.round(Number(formData.shared_min_weeks) || 1)),
            Math.round(Number(formData.shared_max_weeks) || 1)
          )
        : null,
    } as const;

      let insertPayload: Record<string, any> = { ...payload };
      let { data: insertedRows, error: listingInsertError } = await supabase
        .from("listings")
        .insert([insertPayload])
        .select("id");

      let fallbackAttempt = 0;
      const maxFallbackAttempts = 12;

      while (
        listingInsertError &&
        isMissingListingColumnError(listingInsertError) &&
        fallbackAttempt < maxFallbackAttempts
      ) {
        const missingColumns = extractMissingListingColumns(listingInsertError).filter((column) =>
          Object.prototype.hasOwnProperty.call(insertPayload, column)
        );

        if (missingColumns.length === 0) {
          break;
        }

        missingColumns.forEach((column) => {
          delete insertPayload[column];
        });

        fallbackAttempt += 1;
        const retry = await supabase.from("listings").insert([insertPayload]).select("id");
        insertedRows = retry.data;
        listingInsertError = retry.error;
      }

      if (listingInsertError) {
        alert("Error saving listing: " + listingInsertError.message);
        return;
      }

      const listingId =
        Array.isArray(insertedRows) ? insertedRows[0]?.id : (insertedRows as any)?.id;
      if (listingId) {
        fetch("/api/transport/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId }),
        }).catch((err) => {
          console.error("[create-listing] transport refresh failed", err);
        });
      }

      router.push("/host/dashboard");
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <main className="min-h-screen bg-white text-gray-800">
      <div
        className="mx-auto flex h-screen w-full max-w-5xl flex-col px-4 md:px-6"
        onKeyDown={(e) => {
          if (e.key !== "Enter" || step !== LAST_STEP_INDEX) return;
          const target = e.target as HTMLElement | null;
          const tag = target?.tagName?.toLowerCase();
          // Prevent implicit Enter submissions on review/publish step.
          if (tag === "input" || tag === "select" || tag === "textarea") {
            e.preventDefault();
          }
        }}
      >
        <div className="w-full flex flex-1 flex-col overflow-y-auto pb-32 pt-4 md:pt-6">
          <div className="w-full flex justify-end">
            <button
              type="button"
              onClick={() => setShowCancelDialog(true)}
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-black"
            >
              <span aria-hidden className="text-lg leading-none">×</span>
              Close
            </button>
          </div>
          <h1 className="mb-6 text-center text-3xl font-semibold">Let’s get your place ready to host</h1>
          {/* Step 1: Listing model */}
          {step === 0 && (
            <section className="w-full">
              <h2 className="mb-3 text-center text-2xl font-medium">How do you want to offer this space?</h2>
              <p className="mb-6 text-center text-gray-600">
                Choose the product model first. Pricing and setup fields will adapt automatically.
              </p>
              <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2">
                {LISTING_MODEL_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={`border rounded-xl p-5 text-left transition-all duration-150 focus:outline-none ${
                      formData.stay_model === option.value
                        ? "border-black bg-gray-100"
                        : "border-gray-300 bg-white hover:border-black"
                    }`}
                    onClick={() => handleModelSelect(option.value)}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                          formData.stay_model === option.value
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 bg-white text-gray-700"
                        }`}
                      >
                        <option.icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold text-gray-900">{option.label}</span>
                          <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            {option.value === "shared" ? "Weekly" : "Nightly"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-500">{option.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {errors.stay_model && (
                <p className="text-red-600 text-sm mt-1">{errors.stay_model}</p>
              )}
              {formData.stay_model === "shared" ? (
                <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white">
                      <Users className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-slate-900">How Shared Stay works</h3>
                      <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                        <p>Guests book individual spots in your property.</p>
                        <p>The first guest secures the stay by booking their spot.</p>
                        <p>Other professionals can continue joining until all spots are filled.</p>
                        <p>You stay in control of availability and pricing.</p>
                      </div>
                      <p className="mt-3 text-sm font-medium text-slate-800">
                        Example: 4 professionals staying near STN for 3 weeks.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          )}

          {/* Step 2: Place Type */}
          {step === 1 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-6 text-center">Which of these best describes your place?</h2>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-4 mb-8">
                {PLACE_TYPES.map((type) => (
                  <button
                    type="button"
                    key={type.value}
                    className={`border rounded-xl p-6 flex flex-col items-center justify-center text-lg font-medium transition-all duration-150 focus:outline-none ${formData.place_type === type.value ? "border-black bg-gray-100" : "border-gray-300 bg-white hover:border-black"}`}
                    onClick={() => handleCardSelect("place_type", type.value)}
                  >
                    <type.icon
                      className={`mb-2 h-8 w-8 ${formData.place_type === type.value ? "text-gray-900" : "text-gray-600"}`}
                      aria-hidden="true"
                    />
                    {type.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          {/* Step 3: Room Type */}
          {step === 2 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-6 text-center">What type of place will guests have?</h2>
              <div className="flex flex-col gap-4 mb-8">
                {ROOM_TYPES.map((type) => (
                  <button
                    type="button"
                    key={type.value}
                    className={`border rounded-xl p-6 flex items-center justify-between text-lg font-medium transition-all duration-150 focus:outline-none ${formData.type === type.value ? "border-black bg-gray-100" : "border-gray-300 bg-white hover:border-black"}`}
                    onClick={() => handleCardSelect("type", type.value)}
                  >
                    <type.icon
                      className={`mr-4 h-7 w-7 flex-shrink-0 ${formData.type === type.value ? "text-gray-900" : "text-gray-600"}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      {type.label}
                      <div className="text-sm text-gray-500 font-normal">{type.description}</div>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {/* Step 4: Location */}
          {step === 3 && (
            <section className="w-full pb-6">
              <h2 className="text-2xl font-medium mb-6 text-center">Where&apos;s your place located?</h2>

              {/* Address / Postcode search */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="address">Postcode or address</label>
                <div className="flex gap-2">
                  <input
                    id="address"
                    type="text"
                    value={addressQuery}
                    onChange={(e) => {
                      const next = e.target.value;
                      setAddressQuery(next);
                      if (next.trim() !== formData.location) {
                        setHasCoordinates(false);
                        setFormData((prev: any) => ({ ...prev, location: "" }));
                      }
                    }}
                    className="border border-black p-3 rounded w-full"
                    placeholder="e.g. SW1A 1AA or 10 Downing St"
                    autoComplete="off"
                  />
                </div>
                {/* Use my location button and lat/lng */}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={useMyLocation}
                    className="text-sm underline text-gray-700 hover:text-black"
                  >
                    Use my current location
                  </button>
                  {formData.latitude && formData.longitude ? (
                    <span className="text-xs text-gray-500">Lat: {(formData as any).latitude.toFixed(5)}, Lng: {(formData as any).longitude.toFixed(5)}</span>
                  ) : null}
                </div>
                {/* Suggestions dropdown */}
                {suggestions.length > 0 && (
                  <div className="mt-2 border rounded-lg overflow-hidden divide-y">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          // Update form and map when a suggestion is chosen
                          setFormData((prev: any) => ({
                            ...prev,
                            location: s.place_name,
                            latitude: s.center[1],
                            longitude: s.center[0],
                          }));
                          setSuggestions([]);
                          setAddressQuery(s.place_name);
                          setHasCoordinates(true);
                        }}
                        className="w-full text-left p-3 hover:bg-gray-50"
                      >
                        {s.place_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Airport (IATA) select */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="airport_code">Nearest airport (IATA)</label>
                <select
                  id="airport_code"
                  name="airport_code"
                  value={formData.airport_code}
                  onChange={handleChange}
                  className="border border-black p-3 rounded w-full bg-white"
                >
                  <option value="">Select an airport</option>
                  {airportChoices.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                  ))}
                </select>
                {/* Quick-pick airport chips */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {airportChoices.map((a) => (
                    <button
                      key={a.code}
                      type="button"
                      onClick={() => setFormData((p: any) => ({ ...p, airport_code: a.code }))}
                      className={`px-3 py-1 rounded-full border text-sm ${formData.airport_code === a.code ? 'border-black bg-gray-100' : 'border-gray-300 bg-white hover:border-black'}`}
                    >
                      {a.code}
                    </button>
                  ))}
                </div>
                {errors.airport_code && <p className="text-red-600 text-sm mt-1">{errors.airport_code}</p>}
              </div>

              {/* Resolved address (read-only) */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="location">Selected address</label>
                <input
                  id="location"
                  type="text"
                  name="location"
                  value={formData.location}
                  readOnly
                  className="border border-black p-3 rounded w-full bg-gray-50"
                  placeholder="Choose from search results above"
                />
                {errors.location && <p className="text-red-600 text-sm mt-1">{errors.location}</p>}
                {errors.coordinates && <p className="text-red-600 text-sm mt-1">{errors.coordinates}</p>}
              </div>

              {/* Map */}
              <div className="relative w-full h-72 rounded-xl overflow-hidden border mb-3">
                {MAPBOX_TOKEN ? (
                  <AeronoocMap
                    latitude={(formData as any).latitude}
                    longitude={(formData as any).longitude}
                    zoom={12}
                    mapStyle="mapbox://styles/mapbox/navigation-day-v1"
                    height={280}
                    onMove={(lat: number, lng: number) =>
                      setFormData((p: any) => {
                        setHasCoordinates(true);
                        return { ...p, latitude: lat, longitude: lng };
                      })
                    }
                    onMarkerDragEnd={(lat: number, lng: number) =>
                      setFormData((p: any) => {
                        setHasCoordinates(true);
                        return { ...p, latitude: lat, longitude: lng };
                      })
                    }
                    className="rounded-lg"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-600">
                    Set NEXT_PUBLIC_MAPBOX_TOKEN in your .env.local to enable the map.
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500">Drag the pin to the exact building entrance for precise placement.</p>
            </section>
          )}
          {/* Step 5: Basics */}
          {step === 4 && (
            <section className="w-full">
              <h2 className="mb-2 text-center text-2xl font-medium">What can guests expect?</h2>
              <p className="mb-5 text-center text-sm text-gray-600">
                Set the key occupancy details guests look for first.
              </p>

              <div className="mx-auto mb-8 max-w-2xl rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Guests</p>
                      <p className="text-xs text-gray-500">Maximum occupancy</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateCounterField("guests", -1, 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 transition hover:border-gray-900"
                        aria-label="Decrease guests"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span className="w-10 text-center text-lg font-semibold text-gray-900">{formData.guests}</span>
                      <button
                        type="button"
                        onClick={() => updateCounterField("guests", 1, 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 transition hover:border-gray-900"
                        aria-label="Increase guests"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {errors.guests ? <p className="-mt-2 text-sm text-red-600">{errors.guests}</p> : null}

                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{isHourlyBooking ? "Rest spaces" : "Beds"}</p>
                      <p className="text-xs text-gray-500">{isHourlyBooking ? "Sleeping/resting capacity" : "Total bed count"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateCounterField("beds", -1, 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 transition hover:border-gray-900"
                        aria-label="Decrease beds"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span className="w-10 text-center text-lg font-semibold text-gray-900">{formData.beds}</span>
                      <button
                        type="button"
                        onClick={() => updateCounterField("beds", 1, 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 transition hover:border-gray-900"
                        aria-label="Increase beds"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {errors.beds ? <p className="-mt-2 text-sm text-red-600">{errors.beds}</p> : null}

                  {!isHourlyBooking && formData.type !== "private room" ? (
                    <>
                      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Bedrooms</p>
                          <p className="text-xs text-gray-500">Private sleeping rooms</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateCounterField("bedrooms", -1, 0)}
                            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 transition hover:border-gray-900"
                            aria-label="Decrease bedrooms"
                          >
                            <Minus className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <span className="w-10 text-center text-lg font-semibold text-gray-900">{formData.bedrooms}</span>
                          <button
                            type="button"
                            onClick={() => updateCounterField("bedrooms", 1, 0)}
                            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 transition hover:border-gray-900"
                            aria-label="Increase bedrooms"
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      {errors.bedrooms ? <p className="-mt-2 text-sm text-red-600">{errors.bedrooms}</p> : null}
                    </>
                  ) : null}

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Bathrooms</p>
                      <p className="text-xs text-gray-500">{isHourlyBooking ? "Shared or private, if any" : "Total bathrooms available"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateCounterField("bathrooms", -1, 0)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 transition hover:border-gray-900"
                        aria-label="Decrease bathrooms"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span className="w-10 text-center text-lg font-semibold text-gray-900">{formData.bathrooms}</span>
                      <button
                        type="button"
                        onClick={() => updateCounterField("bathrooms", 1, 0)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 transition hover:border-gray-900"
                        aria-label="Increase bathrooms"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {errors.bathrooms ? <p className="text-sm text-red-600">{errors.bathrooms}</p> : null}
                </div>
              </div>
            </section>

          )}
          {/* Step 6: Amenities (new schema) */}
          {step === 5 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-3 text-center">Tell guests what your place has to offer</h2>
<p className="mb-8 text-center text-gray-600">
  Select every amenity this listing includes. Core Veloro amenities are highlighted first.
</p>
{rentalTypeConfig.amenityExclusions.length > 0 && (
  <p className="mb-6 text-center text-xs text-gray-500">
    Some longer-stay amenities are hidden for hourly listings.
  </p>
)}
              <div className="space-y-8">
                {amenityGroups.map(({ group, items }) => (
                  <div key={group}>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xl font-semibold text-gray-900">{group}</h3>
                      <span className="text-xs uppercase tracking-[0.2em] text-gray-500">
                        {items.filter((item) => item.required).length} core
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((amenity) => {
                        const selected = selectedAmenities.includes(amenity.code);
                        const isEditable = amenity.editable !== false;
                        const Icon = getAmenityIcon(amenity.icon);
                        return (
                          <button
                            type="button"
                            key={amenity.code}
                            onClick={() => toggleAmenity(amenity.code)}
                            aria-disabled={!isEditable}
                            className={`rounded-2xl border px-4 py-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${
                              selected
                                ? "border-black bg-black text-white shadow-lg"
                                : isEditable
                                ? "border-gray-200 hover:border-gray-400"
                                : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <Icon
                                className={`h-6 w-6 flex-shrink-0 ${
                                  selected ? "text-white" : isEditable ? "text-gray-800" : "text-gray-400"
                                }`}
                                aria-hidden="true"
                              />
                              <div>
                                <p className="text-sm font-semibold">
                                  {amenity.label}
                                </p>
                                <p className={`text-xs ${selected ? "text-white/80" : "text-gray-500"}`}>
                                  {amenity.editable === false
                                    ? "System-provided"
                                    : amenity.required
                                    ? "Core amenity"
                                    : "Optional"}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {/* Step 7: Photos */}
          {step === 6 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-6 text-center">Add some great photos of your place</h2>
              <p className="text-center text-gray-600 mb-6">Photos help guests picture themselves staying at your place.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {photoFiles.length > 0 ? (
                  photoFiles.map((file, index) => (
                    <div key={index} className="border rounded-xl overflow-hidden">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`Preview ${index + 1}`}
                        className="w-full h-40 object-cover"
                      />
                    </div>
                  ))
                ) : (
                  [1, 2, 3].map((num) => (
                    <div
                      key={num}
                      className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center text-gray-400 hover:border-black transition"
                    >
                      <Camera className="mb-2 h-9 w-9" aria-hidden="true" />
                      <span>Photo {num}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-center">
                <label className="bg-black text-white font-semibold px-6 py-3 rounded cursor-pointer hover:bg-gray-900 transition">
                  Upload photos
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    accept="image/*"
                    required
                    onChange={(e) => {
                      if (e.target.files) {
                        const filesArray = Array.from(e.target.files);
                        if (filesArray.length < 5) {
                          alert("Please upload at least 5 photos.");
                          e.target.value = ""; // reset input
                          return;
                        }
                        setPhotoFiles(filesArray);
                      }
                    }}
                  />
                </label>
              </div>
              {errors.photos ? (
                <p className="mt-3 text-center text-sm text-red-600">{errors.photos}</p>
              ) : null}
            </section>
          )}
          {/* Step 8: Title & Description */}
          {step === 7 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-6 text-center">Title & Description</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="title">Title</label>
                <input
                  id="title"
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  className="border border-black p-3 rounded w-full"
                  placeholder="Give your place a catchy title"
                />
                {errors.title && <p className="text-red-600 text-sm mt-1">{errors.title}</p>}
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="description">Description</label>
                <textarea
                  id="description"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  className="border border-black p-3 rounded w-full"
                  rows={5}
                  placeholder="Describe your place"
                />
                {errors.description && <p className="text-red-600 text-sm mt-1">{errors.description}</p>}
              </div>
            </section>
          )}
          {/* Step 9: Pricing & Availability */}
          {step === 8 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-3 text-center">
                {isHourlyBooking ? "Set your hourly price" : "Pricing setup"}
              </h2>
              <p className="mb-6 text-center text-gray-600">
                {isHourlyBooking
                  ? "Guests book this space by the hour for short rest windows. Start with your base hourly rate - you can adjust it later."
                  : "Configure core pricing first, then layer longer-stay and advanced options."}
              </p>

              <div className="space-y-6">
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Section A — Base pricing</h3>
                  {formData.is_shared_stay ? (
                    <div className="mt-4 space-y-4">
                      <p className="text-sm leading-6 text-gray-600">
                        Shared Stay pricing is based on the total weekly property price. Flexivo
                        shows guests a per-person weekly price.
                      </p>

                      <details className="rounded-2xl border border-slate-200 bg-white p-4">
                        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
                          What happens if not all spots are filled?
                        </summary>
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                          The first guest secures the booking. Additional guests may continue joining the stay, but your booking is already confirmed.
                        </p>
                      </details>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2">
                            Total weekly price for the property (GBP)
                          </label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={formData.shared_weekly_price_gbp}
                            onChange={(event) =>
                              setFormData((prev) => ({
                                ...prev,
                                shared_weekly_price_gbp: event.target.value,
                              }))
                            }
                            className="border border-black p-3 rounded w-full"
                            placeholder="e.g. 600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2">
                            Total spots
                          </label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={formData.shared_total_spots}
                            onChange={(event) =>
                              setFormData((prev) => ({
                                ...prev,
                                shared_total_spots: Number(event.target.value || 1),
                              }))
                            }
                            className="border border-black p-3 rounded w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2">
                            Minimum weeks
                          </label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={formData.shared_min_weeks}
                            onChange={(event) =>
                              setFormData((prev) => ({
                                ...prev,
                                shared_min_weeks: Number(event.target.value || 1),
                              }))
                            }
                            className="border border-black p-3 rounded w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2">
                            Maximum weeks
                          </label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={formData.shared_max_weeks}
                            onChange={(event) =>
                              setFormData((prev) => ({
                                ...prev,
                                shared_max_weeks: Number(event.target.value || 1),
                              }))
                            }
                            className="border border-black p-3 rounded w-full"
                          />
                        </div>

                        <div className="md:col-span-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Guests will see</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {formatGBPFromPence(sharedPerPersonWeeklyPreviewPence)} per person / week
                          </p>
                          <p className="mt-2 text-xs text-gray-500">
                            Professionals book individual spots in the property.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-4">
                        <label
                          className="block text-sm font-medium text-gray-800 mb-1"
                          htmlFor={isHourlyBooking ? "price_per_hour" : "price_per_night"}
                        >
                          {isHourlyBooking ? "Hourly rate" : "Nightly rate"} (GBP)
                        </label>
                        <input
                          id={isHourlyBooking ? "price_per_hour" : "price_per_night"}
                          type="number"
                          name={isHourlyBooking ? "price_per_hour" : "price_per_night"}
                          value={isHourlyBooking ? formData.price_per_hour : formData.price_per_night}
                          onChange={handleChange}
                          className="border border-black p-3 rounded w-full"
                          placeholder={isHourlyBooking ? "e.g. 35" : "e.g. 110"}
                          inputMode="numeric"
                          min="1"
                          step="1"
                          autoComplete="off"
                        />
                        {(isHourlyBooking ? errors.price_per_hour : errors.price_per_night) && (
                          <p className="text-red-600 text-sm mt-1">
                            {isHourlyBooking ? errors.price_per_hour : errors.price_per_night}
                          </p>
                        )}
                      </div>

                      {isHourlyBooking ? (
                        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">What guests see</p>
                          <p className="mt-1 text-xl font-semibold text-gray-900">
                            £{Number(formData.price_per_hour || 0).toLocaleString("en-GB")} / hour
                          </p>
                          <p className="mt-2 text-xs text-gray-500">Includes guest-facing pricing.</p>
                        </div>
                      ) : null}

                      {!isHourlyBooking ? (
                        <div className="mt-4">
                          <label className="block text-xs font-semibold text-gray-600 mb-2">
                            Adjust nightly rate
                          </label>
                          <input
                            type="range"
                            min={NIGHTLY_RATE_MIN}
                            max={NIGHTLY_RATE_MAX}
                            step="1"
                            value={(() => {
                              const numeric = Number(formData.price_per_night);
                              if (!Number.isFinite(numeric) || numeric <= 0) return NIGHTLY_RATE_MIN;
                              return Math.min(NIGHTLY_RATE_MAX, Math.max(NIGHTLY_RATE_MIN, Math.round(numeric)));
                            })()}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                price_per_night: String(e.target.value),
                              }))
                            }
                            className="w-full accent-black"
                          />
                          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                            <span>£{NIGHTLY_RATE_MIN}</span>
                            <span>£{NIGHTLY_RATE_MAX}</span>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {!isHourlyBooking && !formData.is_shared_stay ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Section B — Longer-stay pricing</h3>
                    <p className="mt-2 text-sm text-gray-600">Encourage longer bookings with weekly or monthly rates.</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="price_per_week">
                          Weekly rate (GBP)
                        </label>
                        <input
                          id="price_per_week"
                          type="number"
                          name="price_per_week"
                          value={formData.price_per_week}
                          onChange={handleChange}
                          className="border border-black p-3 rounded w-full"
                          placeholder="e.g. 600"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          autoComplete="off"
                        />
                        {errors.price_per_week && (
                          <p className="text-red-600 text-sm mt-1">{errors.price_per_week}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="price_per_month">
                          Monthly rate (GBP)
                        </label>
                        <input
                          id="price_per_month"
                          type="number"
                          name="price_per_month"
                          value={formData.price_per_month}
                          onChange={handleChange}
                          className="border border-black p-3 rounded w-full"
                          placeholder="e.g. 2200"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          autoComplete="off"
                        />
                        {errors.price_per_month && (
                          <p className="text-red-600 text-sm mt-1">{errors.price_per_month}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {!isHourlyBooking && !formData.is_shared_stay && formData.allow_flexible_stays ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Section C — Flexible stay settings</h3>
                    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <p className="text-sm font-semibold text-gray-900">
                        Choose how flexible extensions work for this stay.
                      </p>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2">
                            Guests may extend up to
                          </label>
                          <select
                            value={formData.flex_max_extension_nights}
                            onChange={(event) =>
                              setFormData((prev) => ({
                                ...prev,
                                flex_max_extension_nights: Number(event.target.value),
                              }))
                            }
                            className="w-full rounded border border-black bg-white p-3"
                          >
                            <option value={3}>3 nights</option>
                            <option value={7}>7 nights</option>
                            <option value={14}>14 nights</option>
                            <option value={30}>30 nights</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2">
                            Guests must confirm extension before
                          </label>
                          <select
                            value={formData.flex_extension_notice_hours ?? 24}
                            onChange={(event) =>
                              setFormData((prev) => ({
                                ...prev,
                                flex_extension_notice_hours: Number(event.target.value),
                              }))
                            }
                            className="w-full rounded border border-black bg-white p-3"
                          >
                            <option value={12}>12 hours before checkout</option>
                            <option value={24}>24 hours before checkout</option>
                            <option value={48}>48 hours before checkout</option>
                            <option value={72}>72 hours before checkout</option>
                          </select>
                        </div>
                      </div>
                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                          Extension night pricing
                        </p>
                        <div
                          className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2"
                          role="radiogroup"
                          aria-label="Extension night pricing"
                        >
                          <button
                            type="button"
                            role="radio"
                            aria-checked={formData.flex_extension_pricing_mode === "same_rate"}
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                flex_extension_pricing_mode: "same_rate",
                              }))
                            }
                            className={`rounded-xl border p-3 text-left transition ${
                              formData.flex_extension_pricing_mode === "same_rate"
                                ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                                : "border-gray-200 bg-white text-gray-800 hover:border-gray-400"
                            }`}
                          >
                            <p className="text-sm font-semibold">Same nightly rate</p>
                            <p
                              className={`mt-1 text-xs ${
                                formData.flex_extension_pricing_mode === "same_rate"
                                  ? "text-slate-100"
                                  : "text-gray-500"
                              }`}
                            >
                              Guests pay the normal nightly rate for extension nights.
                            </p>
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={formData.flex_extension_pricing_mode === "premium_10"}
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                flex_extension_pricing_mode: "premium_10",
                              }))
                            }
                            className={`rounded-xl border p-3 text-left transition ${
                              formData.flex_extension_pricing_mode === "premium_10"
                                ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                                : "border-gray-200 bg-white text-gray-800 hover:border-gray-400"
                            }`}
                          >
                            <p className="text-sm font-semibold">+10% extension premium</p>
                            <p
                              className={`mt-1 text-xs ${
                                formData.flex_extension_pricing_mode === "premium_10"
                                  ? "text-slate-100"
                                  : "text-gray-500"
                              }`}
                            >
                              Useful for uncertain schedules and short-notice flexibility.
                            </p>
                          </button>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-gray-500">
                        Guests can extend without rebooking and are charged only for nights they confirm.
                      </p>
                    </div>
                  </div>
                ) : null}

                {!isHourlyBooking && !formData.is_shared_stay ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Section D — Custom date pricing</h3>
                        <p className="text-sm text-gray-600 mt-2">Override prices for peak dates or special events.</p>
                      </div>
                      <button
                        type="button"
                        onClick={addPriceOverride}
                        className="rounded-full border border-black px-4 py-2 text-sm font-semibold text-black hover:bg-black hover:text-white transition"
                      >
                        Add custom price
                      </button>
                    </div>
                    {formData.price_overrides.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        No custom pricing yet. Add one if certain dates should cost more or less.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {formData.price_overrides.map((override) => (
                          <div
                            key={override.id}
                            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end border border-gray-200 rounded-2xl p-3"
                          >
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 mb-1">
                                Label (optional)
                              </label>
                              <input
                                type="text"
                                value={override.label}
                                onChange={(e) =>
                                  updatePriceOverride(override.id, "label", e.target.value)
                                }
                                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                                placeholder="e.g. Christmas week"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 mb-1">
                                Start date
                              </label>
                              <input
                                type="date"
                                value={override.start_date}
                                onChange={(e) =>
                                  updatePriceOverride(override.id, "start_date", e.target.value)
                                }
                                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 mb-1">
                                End date
                              </label>
                              <input
                                type="date"
                                value={override.end_date}
                                onChange={(e) =>
                                  updatePriceOverride(override.id, "end_date", e.target.value)
                                }
                                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">
                                  Price (GBP)
                                </label>
                                <input
                                  type="number"
                                  value={override.price}
                                  onChange={(e) =>
                                    updatePriceOverride(override.id, "price", e.target.value)
                                  }
                                  className="w-32 rounded border border-gray-300 px-3 py-2 text-sm"
                                  placeholder="e.g. 180"
                                  min="1"
                                  step="1"
                                  inputMode="numeric"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => removePriceOverride(override.id)}
                                className="self-start text-sm font-semibold text-red-600 hover:underline"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {errors.price_overrides && (
                      <p className="text-red-600 text-sm mt-2">{errors.price_overrides}</p>
                    )}
                  </div>
                ) : null}

                {!isHourlyBooking && !formData.is_shared_stay ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">What guests see vs what you receive</h3>
                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-sm text-gray-700">What guests see</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {hostQuote ? formatGBPFromPence(hostQuote.guest_unit_price_pence) : "—"} / night
                      </p>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-sm text-gray-700">You receive</p>
                      <p className="text-base font-semibold text-gray-900">
                        {hostQuote ? formatGBPFromPence(hostQuote.host_net_nightly_pence) : "—"} / night
                      </p>
                    </div>
                    {hostQuote ? (
                      <div className="mt-3 space-y-1 text-xs text-gray-600">
                        <div className="flex items-center justify-between">
                          <span>Estimated platform fee</span>
                          <span>{formatGBPFromPence(hostQuote.platform_fee_est_pence)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Estimated payment fee</span>
                          <span>{formatGBPFromPence(hostQuote.stripe_fee_est_pence)}</span>
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-3 text-xs text-gray-500">
                      Guest-facing prices include fees to keep pricing simple for guests.
                    </p>
                    {hostQuoteLoading && (
                      <p className="mt-2 text-xs text-gray-500">Updating quote…</p>
                    )}
                    {hostQuoteError && (
                      <p className="mt-2 text-xs text-red-600">{hostQuoteError}</p>
                    )}
                  </div>
                ) : null}

                {isHourlyBooking ? (
                  <p className="text-sm text-gray-600">
                    Hourly stays use one simple hourly rate. Guests book short rest windows, so weekly and monthly pricing are not needed here.
                  </p>
                ) : null}
              </div>
            </section>
          )}
          {/* Step 10: Review */}
          {step === 9 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-3 text-center">Review your listing</h2>
              <p className="mb-6 text-center text-gray-600">
                Double-check key details before publishing.
              </p>
              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Listing model</h3>
                  <p className="mt-2 text-base font-semibold text-gray-900">{selectedListingModelConfig.label}</p>
                  <p className="mt-1 text-sm text-gray-600">{selectedListingModelConfig.description}</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Space</h3>
                    <p className="mt-2 text-sm text-gray-700">Place type: <span className="font-semibold text-gray-900">{formData.place_type}</span></p>
                    <p className="mt-1 text-sm text-gray-700">Room type: <span className="font-semibold text-gray-900">{formData.type}</span></p>
                    <p className="mt-1 text-sm text-gray-700">Guests: <span className="font-semibold text-gray-900">{formData.guests}</span></p>
                    <p className="mt-1 text-sm text-gray-700">Beds: <span className="font-semibold text-gray-900">{formData.beds}</span></p>
                    {!isHourlyBooking && formData.type !== "private room" ? (
                      <p className="mt-1 text-sm text-gray-700">Bedrooms: <span className="font-semibold text-gray-900">{formData.bedrooms}</span></p>
                    ) : null}
                    <p className="mt-1 text-sm text-gray-700">Bathrooms: <span className="font-semibold text-gray-900">{formData.bathrooms}</span></p>
                    <p className="mt-1 text-sm text-gray-700">
                      Booking style:{" "}
                      <span className="font-semibold text-gray-900">
                        {rentalTypeConfig.bookingUnit === "hourly" ? "Hourly" : "Nightly"}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Location</h3>
                    <p className="mt-2 text-sm text-gray-700">{formData.location || "No location selected"}</p>
                    <p className="mt-1 text-sm text-gray-700">Airport: <span className="font-semibold text-gray-900">{formData.airport_code || "—"}</span></p>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Pricing</h3>
                  {formData.is_shared_stay ? (
                    <>
                      <p className="mt-2 text-sm text-gray-700">
                        Total weekly property price:{" "}
                        <span className="font-semibold text-gray-900">
                          £{Number(formData.shared_weekly_price_gbp || 0).toLocaleString("en-GB")}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-gray-700">
                        Total spots:{" "}
                        <span className="font-semibold text-gray-900">{formData.shared_total_spots || 0}</span>
                      </p>
                      <p className="mt-1 text-sm text-gray-700">
                        Guests will see:{" "}
                        <span className="font-semibold text-gray-900">
                          {formatGBPFromPence(sharedPerPersonWeeklyPreviewPence)} per person / week
                        </span>
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-2 text-sm text-gray-700">
                        Base rate:{" "}
                        <span className="font-semibold text-gray-900">
                          {isHourlyBooking
                            ? `£${formData.price_per_hour || "0"} / hour`
                            : `£${formData.price_per_night || "0"} / night`}
                        </span>
                      </p>
                      {!isHourlyBooking ? (
                        <p className="mt-1 text-sm text-gray-700">
                          Weekly/Monthly:{" "}
                          <span className="font-semibold text-gray-900">
                            {formData.price_per_week ? `£${formData.price_per_week} / week` : "—"} ·{" "}
                            {formData.price_per_month ? `£${formData.price_per_month} / month` : "—"}
                          </span>
                        </p>
                      ) : null}
                      {formData.allow_flexible_stays ? (
                        <>
                          <p className="mt-1 text-sm text-gray-700">
                            Max extension:{" "}
                            <span className="font-semibold text-gray-900">
                              {formData.flex_max_extension_nights} nights
                            </span>
                          </p>
                          <p className="mt-1 text-sm text-gray-700">
                            Extension notice:{" "}
                            <span className="font-semibold text-gray-900">
                              {formData.flex_extension_notice_hours} hours before checkout
                            </span>
                          </p>
                          <p className="mt-1 text-sm text-gray-700">
                            Extension pricing:{" "}
                            <span className="font-semibold text-gray-900">
                              {formData.flex_extension_pricing_mode === "premium_10"
                                ? "+10% extension premium"
                                : "Same nightly rate"}
                            </span>
                          </p>
                        </>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Content</h3>
                  <p className="mt-2 text-sm text-gray-700">Title: <span className="font-semibold text-gray-900">{formData.title || "—"}</span></p>
                  <p className="mt-1 text-sm text-gray-700">Amenities selected: <span className="font-semibold text-gray-900">{selectedAmenities.length}</span></p>
                  <p className="mt-1 text-sm text-gray-700">Photos selected: <span className="font-semibold text-gray-900">{photoFiles.length}</span></p>
                </div>
              </div>
            </section>
          )}
        </div>
        {/* Navigation footer */}
        <div className="sticky bottom-0 z-20 -mx-4 border-t bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="text-gray-500 text-base font-medium"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </button>
            {step < TOTAL_STEPS - 1 ? (
              <button
                type="button"
                className="bg-black text-white font-semibold px-6 py-2 rounded hover:bg-gray-900 text-base"
                onClick={() => {
                  if (validateStep()) {
                    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
                  }
                }}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                disabled={isPublishing}
                className="bg-black text-white font-semibold px-6 py-2 rounded hover:bg-gray-900 text-base disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  void handlePublish("save_publish_button");
                }}
              >
                {isPublishing ? "Saving..." : "Save & publish"}
              </button>
            )}
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-black transition-all duration-300"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            ></div>
          </div>
        </div>
        <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Discard this listing?</DialogTitle>
              <DialogDescription>
                Your draft will be discarded and you’ll exit the listing setup.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <button
                type="button"
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300"
                onClick={() => setShowCancelDialog(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900"
                onClick={() => {
                  setShowCancelDialog(false);
                  router.push("/host/dashboard");
                }}
              >
                Discard & exit
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
