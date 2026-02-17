import { useState, useEffect, useMemo } from "react";
import AeronoocMap from "@/components/map";
import { AMENITY_SCHEMA, type AmenitySchema, getAmenityIcon } from "@/lib/amenities";
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
  platform_fee_est_pence: number;
  stripe_fee_est_pence: number;
  platform_margin_est_pence: number;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: "all_in_v1";
};

const PLACE_TYPES = [
  { value: "house", label: "House", icon: "🏠" },
  { value: "flat", label: "Flat/apartment", icon: "🏢" },
  { value: "guest_house", label: "Guest house", icon: "🏠" },
  { value: "cabin", label: "Cabin", icon: "🛖" },
  { value: "boat", label: "Boat", icon: "⛵" },
];

const ROOM_TYPES = [
  { value: "entire place", label: "An entire place", description: "Guests have the whole place to themselves.", icon: "🏠" },
  { value: "private room", label: "A room", description: "Guests have their own room in a home, plus access to shared spaces.", icon: "🚪" },
  { value: "shared room", label: "A shared room", description: "Guests sleep in a room shared with others.", icon: "🛏️" },
];

const RENTAL_TYPE_OPTIONS = [
  {
    value: "overnight_stay",
    label: "Overnight stay",
    description: "Traditional overnight stays booked per night.",
    icon: "N",
    bookingUnit: "nightly",
  },
  {
    value: "crashpad",
    label: "Extended stay",
    description: "Longer-term stays booked by the night.",
    icon: "E",
    bookingUnit: "nightly",
  },
  {
    value: "day_use",
    label: "Day-use room",
    description: "Short stays sold by the hour for daytime rest.",
    icon: "H",
    bookingUnit: "hourly",
  },
  {
    value: "split_rest",
    label: "Split-rest / nap room",
    description: "Short rest windows between shifts and flights.",
    icon: "S",
    bookingUnit: "hourly",
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
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [formData, setFormData] = useState({
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
    max_guests: "",
    is_shared_booking_allowed: false,
    bedrooms: "",
    beds: "",
    bathrooms: "",
    latitude: 51.5074,
    longitude: -0.1278,
    amenities: [] as string[],
  });
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

  // Step validation helper
  const validateStep = () => {
    const newErrors: { [key: string]: string } = {};
    const isHourly = formData.booking_unit === "hourly";

    if (step === 0) {
      if (!formData.rental_type) newErrors.rental_type = "Select the space type.";
    }
    if (step === 4) {
      if (!formData.location) newErrors.location = "Location is required.";
      if (!formData.airport_code) newErrors.airport_code = "Airport code is required.";
      const lat = Number((formData as any).latitude);
      const lng = Number((formData as any).longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !hasCoordinates) {
        newErrors.coordinates = "Select an address to set accurate coordinates.";
      }
    }
    if (step === 5) {
      if (!formData.max_guests) newErrors.max_guests = "Number of guests is required.";
      if (!isHourly) {
        if (!formData.bedrooms) newErrors.bedrooms = "Number of bedrooms is required.";
        if (!formData.beds) newErrors.beds = "Number of beds is required.";
        if (!formData.bathrooms) newErrors.bathrooms = "Number of bathrooms is required.";
      }
    }
    if (step === 8) {
      if (!formData.title) newErrors.title = "Title is required.";
      if (!formData.description) newErrors.description = "Description is required.";
    }
    if (step === 9) {
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


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    const pricing = parsePricingFields();
    if (!pricing) return;
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

    // Insert listing with photo URLs
    const payload = {
      ...formData,
      ...amenityFlags,
      amenities: amenityCodes,
      user_id: userId,
      airport_code: formData.airport_code.toUpperCase().trim(),
      price_per_night: isHourlyBooking ? null : nightly,
      price_per_hour: isHourlyBooking ? hourly : null,
      price_per_week: isHourlyBooking ? null : weekly,
      price_per_month: isHourlyBooking ? null : monthly,
      price_overrides: isHourlyBooking ? null : overrides.length ? overrides : null,
      max_guests: formData.max_guests === "" ? null : Number(formData.max_guests),
      bedrooms: formData.bedrooms === "" ? null : Number(formData.bedrooms),
      beds: formData.beds === "" ? null : Number(formData.beds),
      bathrooms: formData.bathrooms === "" ? null : Number(formData.bathrooms),
      photos: photoUrls,
    } as const;

    const { data: insertedRows, error: listingInsertError } = await supabase
      .from("listings")
      .insert([payload])
      .select("id");

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
  };

  return (
    <main className="min-h-screen bg-white text-gray-800 flex flex-col items-center px-0 py-0">
      <form className="w-full max-w-4xl flex flex-col items-center justify-center min-h-screen" onSubmit={handleSubmit}>
        <div className="w-full flex flex-col items-center justify-center py-10">
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
          <h1 className="text-3xl font-semibold mb-8 text-center">Let’s get your place ready to host</h1>
          {/* Step 1: Rental Type */}
          {step === 0 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-3 text-center">What kind of space is this?</h2>
              <p className="mb-6 text-center text-gray-600">
                This choice affects booking behavior and cannot be changed after your first booking.
              </p>
              <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2">
                {RENTAL_TYPE_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={`border rounded-xl p-5 text-left transition-all duration-150 focus:outline-none ${
                      formData.rental_type === option.value
                        ? "border-black bg-gray-100"
                        : "border-gray-300 bg-white hover:border-black"
                    }`}
                    onClick={() => handleCardSelect("rental_type", option.value)}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-700">
                        {option.icon}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold text-gray-900">{option.label}</span>
                          <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            {option.bookingUnit === "hourly" ? "Hourly" : "Nightly"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-500">{option.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {errors.rental_type && (
                <p className="text-red-600 text-sm mt-1">{errors.rental_type}</p>
              )}
            </section>
          )}

          {/* Step 2: Booking Unit */}
          {step === 1 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-3 text-center">How guests book this space</h2>
              <p className="mb-6 text-center text-gray-600">
                This is automatically derived from your space type and is not editable in MVP.
              </p>
              <div className="rounded-2xl border border-gray-200 bg-white p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{bookingUnitCopy.label}</p>
                    <p className="mt-1 text-sm text-gray-600">{bookingUnitCopy.description}</p>
                  </div>
                  <span className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {rentalTypeConfig.bookingUnit === "hourly" ? "Hourly" : "Nightly"}
                  </span>
                </div>
                <p className="mt-3 text-xs text-gray-500">{bookingUnitCopy.note}</p>
                <p className="mt-2 text-xs text-gray-500">
                  Calendar and pricing tools will follow this booking style.
                </p>
              </div>
            </section>
          )}

          {/* Step 3: Place Type */}


          {step === 2 && (
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
                    <span className="text-3xl mb-2">{type.icon}</span>
                    {type.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          {/* Step 4: Room Type */}
          {step === 3 && (
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
                    <span className="text-3xl mr-4">{type.icon}</span>
                    <span className="flex-1">
                      {type.label}
                      <div className="text-sm text-gray-500 font-normal">{type.description}</div>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {/* Step 5: Location */}
          {step === 4 && (
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
          {/* Step 6: Basics */}
          {step === 5 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-6 text-center">Share some basics about your place</h2>
                <div className="grid grid-cols-2 gap-4 mb-8">
    <div>
      <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="max_guests">Guests</label>
      <input
        id="max_guests"
        type="number"
        name="max_guests"
        value={formData.max_guests}
        onChange={handleChange}
        className="border border-black p-3 rounded w-full"
      />
      {errors.max_guests && <p className="text-red-600 text-sm mt-1">{errors.max_guests}</p>}
    </div>
    {!isHourlyBooking && (
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="bedrooms">Bedrooms</label>
        <input
          id="bedrooms"
          type="number"
          name="bedrooms"
          value={formData.bedrooms}
          onChange={handleChange}
          className="border border-black p-3 rounded w-full"
        />
        {errors.bedrooms && <p className="text-red-600 text-sm mt-1">{errors.bedrooms}</p>}
      </div>
    )}
    <div>
      <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="beds">
        {isHourlyBooking ? "Resting spaces" : "Beds"}
      </label>
      <input
        id="beds"
        type="number"
        name="beds"
        value={formData.beds}
        onChange={handleChange}
        className="border border-black p-3 rounded w-full"
      />
      {errors.beds && <p className="text-red-600 text-sm mt-1">{errors.beds}</p>}
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="bathrooms">
        {isHourlyBooking ? "Bathrooms (optional)" : "Bathrooms"}
      </label>
      <input
        id="bathrooms"
        type="number"
        name="bathrooms"
        value={formData.bathrooms}
        onChange={handleChange}
        className="border border-black p-3 rounded w-full"
      />
      {errors.bathrooms && <p className="text-red-600 text-sm mt-1">{errors.bathrooms}</p>}
    </div>
  </div>
  {isHourlyBooking && (
    <p className="text-xs text-gray-500">
      Hourly listings skip bedroom counts and focus on capacity.
    </p>
  )}
</section>

          )}
          {/* Step 7: Amenities (new schema) */}
          {step === 6 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-3 text-center">Tell guests what your place has to offer</h2>
<p className="mb-8 text-center text-gray-600">
  Select every amenity this listing includes. Core Aeronooc amenities are highlighted first.
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
          {/* Step 8: Photos */}
          {step === 7 && (
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
                      <span className="text-4xl mb-2">📸</span>
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
            </section>
          )}
          {/* Step 9: Title & Description */}
          {step === 8 && (
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
          {/* Step 10: Pricing & Availability */}
          {step === 9 && (
            <section className="w-full">
              <h2 className="text-2xl font-medium mb-6 text-center">Pricing & Availability</h2>
              <div className="mb-4">
                <label
                  className="block text-sm font-medium text-gray-800 mb-1"
                  htmlFor={isHourlyBooking ? "price_per_hour" : "price_per_night"}
                >
                  {isHourlyBooking ? "Price per hour" : "Price per night"} (GBP)
                </label>
                <input
                  id={isHourlyBooking ? "price_per_hour" : "price_per_night"}
                  type="number"
                  name={isHourlyBooking ? "price_per_hour" : "price_per_night"}
                  value={isHourlyBooking ? formData.price_per_hour : formData.price_per_night}
                  onChange={handleChange}
                  className="border border-black p-3 rounded w-full"
                  placeholder="e.g. 100"
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
              {!isHourlyBooking && (
                <div className="mb-4">
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
              )}
              {!isHourlyBooking && (
                <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">Guest pays (rounded)</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {hostQuote ? formatGBPFromPence(hostQuote.guest_unit_price_pence) : "—"}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Includes all fees.</p>
                  {hostQuote && (
                    <div className="mt-3 space-y-1 text-xs text-gray-600">
                      <div className="flex items-center justify-between">
                        <span>Your target (per night)</span>
                        <span>{formatGBPFromPence(hostQuote.host_net_nightly_pence)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Stripe fee (est.)</span>
                        <span>{formatGBPFromPence(hostQuote.stripe_fee_est_pence)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Platform fee (est.)</span>
                        <span>{formatGBPFromPence(hostQuote.platform_fee_est_pence)}</span>
                      </div>
                    </div>
                  )}
                  {hostQuoteLoading && (
                    <p className="mt-2 text-xs text-gray-500">Updating guest price…</p>
                  )}
                  {hostQuoteError && (
                    <p className="mt-2 text-xs text-red-600">{hostQuoteError}</p>
                  )}
                </div>
              )}
              {isHourlyBooking ? (
  <p className="text-sm text-gray-600">
    Hourly listings use a single rate in MVP. Weekly/monthly discounts and custom date pricing are disabled.
  </p>
) : (
  <>
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1" htmlFor="price_per_week">
          Weekly Rate (GBP) <span className="text-gray-500 font-normal">(optional)</span>
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
          Monthly Rate (GBP) <span className="text-gray-500 font-normal">(optional)</span>
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

    <div className="mt-6 rounded-2xl border border-dashed border-gray-300 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Custom date pricing</h3>
          <p className="text-sm text-gray-600">
            Override prices for peak weeks, holidays, or special events.
          </p>
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
  </>
)}

<label className="inline-flex items-center mt-4">

                <input
                  type="checkbox"
                  name="is_shared_booking_allowed"
                  checked={formData.is_shared_booking_allowed}
                  onChange={handleChange}
                  className="form-checkbox border border-black"
                />
                <span className="ml-2 text-sm text-gray-800">Allow shared bookings?</span>
              </label>
            </section>
          )}
        </div>
        {/* Navigation buttons */}
        <div className="fixed bottom-0 left-0 w-full flex items-center justify-between px-8 py-3 bg-white border-t z-10">
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
              type="submit"
              className="bg-black text-white font-semibold px-6 py-2 rounded hover:bg-gray-900 text-base"
            >
              Save & exit
            </button>
          )}
        </div>
        {/* Progress bar */}
        <div className="fixed bottom-0 left-0 w-full h-1 bg-gray-200 rounded-full overflow-hidden z-0">
          <div
            className="h-full bg-black transition-all duration-300"
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          ></div>
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
      </form>
    </main>
  );
}
