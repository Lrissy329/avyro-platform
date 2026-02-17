// pages/index.tsx
// Home (Airbnb x Uber style) — sticky search, pill filters, card grid
// Note: we avoid next/image for Supabase URLs

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { AppHeader } from "@/components/AppHeader";
import HomeListingCard from "@/components/HomeListingCard";
import SearchBar from "@/components/SearchBar";
import { formatReviewLabel } from "@/lib/reviews";
import { Listing } from "@/types/Listing";

// --- Helpers ---------------------------------------------------------------
const AIRPORTS = [
  { code: "", label: "Any airport" },
  { code: "STN", label: "London Stansted (STN)" },
  { code: "LTN", label: "London Luton (LTN)" },
  { code: "LHR", label: "London Heathrow (LHR)" },
  { code: "LGW", label: "London Gatwick (LGW)" },
];

const AIRPORT_SUGGESTIONS = [
  { code: "NEARBY", label: "Nearby", subtitle: "Find what’s around you", icon: "📍" },
  { code: "STN", label: "London Stansted, England", subtitle: "Good for quick getaways", icon: "🛫" },
  { code: "LTN", label: "London Luton, England", subtitle: "Near you", icon: "🛫" },
  { code: "LHR", label: "Paris, France (via LHR)", subtitle: "For sights like Eiffel Tower", icon: "🗼" },
  { code: "LGW", label: "Chipping Norton, England", subtitle: "Near you", icon: "🏡" },
];

type Filters = {
  airport: string;
  roomType: string; // "entire place" | "private room" | ""
};

function coerceAirport(x: any) {
  return (x?.airport_code ?? x?.airportCode ?? "").toString();
}
function coerceType(x: any) {
  return (x?.type ?? x?.listing_type ?? "").toString();
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const safeMinutes = (value: unknown): number | null => {
  const n = toNumber(value);
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n);
};

const normaliseTypeLabel = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const lower = value.replace(/_/g, " ").toLowerCase();
  if (lower.includes("entire")) return "Entire place";
  if (lower.includes("private")) return "Private room";
  if (lower.includes("shared")) return "Private room";
  return value.replace(/_/g, " ");
};

const pickImageUrl = (listing: any, signedUrls: Record<string, string>): string => {
  const candidates = [
    signedUrls[listing.id],
    listing.image_url,
    listing.imageUrl,
    listing.thumbnail,
    Array.isArray(listing.photos) ? listing.photos[0] : listing.photos,
  ].filter((src) => typeof src === "string" && src.length > 0) as string[];

  return candidates[0] ?? "/placeholder.jpg";
};

const buildMetaLine = (listing: any): string | null => {
  const airport = coerceAirport(listing);
  const minutes =
    safeMinutes(listing.drive_minutes_offpeak) ??
    safeMinutes(listing.driveMinutesToAirport) ??
    safeMinutes(listing.travelMinutesMin) ??
    safeMinutes(listing.publicTransportMin) ??
    safeMinutes(listing.taxiMin);
  const typeLabel = normaliseTypeLabel(
    listing.listing_type ?? listing.type ?? listing.roomType ?? listing.listingType
  );

  const parts: string[] = [];
  if (minutes != null && airport) parts.push(`${minutes} min to ${airport}`);
  else if (airport) parts.push(airport);
  if (typeLabel) parts.push(typeLabel);

  return parts.length ? parts.join(" · ") : null;
};

const getBadgeText = (listing: any): string => {
  const unit = listing.booking_unit ?? listing.bookingUnit;
  const rental = listing.rental_type ?? listing.rentalType;
  if (unit === "hourly" || rental === "day_use" || rental === "split_rest") return "DAY-USE";
  return "OVERNIGHT";
};

export default function Home() {
  const router = useRouter();

  // Search & filter state
  const [filters, setFilters] = useState<Filters>({
    airport: "",
    roomType: "",
  });
  const airportChoices = useMemo(() => {
    const q = "";
    if (!q) return AIRPORT_SUGGESTIONS;
    return [
      ...AIRPORT_SUGGESTIONS.filter(x => x.code === "NEARBY"),
      ...AIRPORTS
        .filter((a) => (a.code && (a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q))))
        .map((a) => ({ code: a.code, label: a.label, subtitle: "", icon: "🛫" })),
    ];
  }, []);

  // Data state
  const [listings, setListings] = useState<Listing[] | any[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [profile, setProfile] = useState<{
    full_name: string | null;
    avatar_url: string | null;
    role_host: boolean;
    role_guest: boolean;
  } | null>(null);
  const [notifications, setNotifications] = useState(0);

  // Fetch listings
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("listings").select("*");
      if (error) {
        console.error("Failed to fetch listings", error.message);
        setLoading(false);
        return;
      }
      setListings(data || []);

      // Resolve first-photo URL for each listing
      const urlMap: Record<string, string> = {};
      await Promise.all(
        (data || []).map(async (listing: any) => {
          const first = Array.isArray(listing.photos) ? listing.photos[0] : listing.photos;
          if (!first) return;
          if (typeof first === "string" && first.startsWith("http")) {
            urlMap[listing.id] = first;
            return;
          }
          // Treat as Storage path
          if (typeof first === "string") {
            const { data: pub } = supabase.storage.from("listing-photos").getPublicUrl(first);
            if (pub?.publicUrl) urlMap[listing.id] = pub.publicUrl;
          }
        })
      );
      setSignedUrls(urlMap);
      setLoading(false);
    })();
  }, []);

  // Apply filters on the fly
  const filtered = useMemo(() => {
    return (listings || []).filter((l: any) => {
      const airport = coerceAirport(l);
      const type = coerceType(l);

      const airportOk = !filters.airport || airport === filters.airport;
      const typeOk = !filters.roomType || type === filters.roomType;
      return airportOk && typeOk;
    });
  }, [listings, filters]);

  // --- UI Handlers ---------------------------------------------------------
  const onAirportChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, airport: e.target.value }));
  const onTypeClick = (val: string) =>
    setFilters((f) => ({ ...f, roomType: f.roomType === val ? "" : val }));

  // New: handle search from SearchBar -> navigate to /search with query params
  const onSearchBar = (payload: any) => {
    const params = new URLSearchParams();

    // Location / airport code parsing
    const locRaw = String(payload?.location || "").trim();
    if (locRaw) params.set("location", locRaw);
    const reParens = locRaw.match(/\(([A-Z]{3})\)/);      // e.g., "London Heathrow (LHR)"
    const reCode = locRaw.match(/\b(STN|LTN|LHR|LGW)\b/); // direct IATA code typed
    const airport = reParens?.[1] || reCode?.[1] || "";
    if (airport) params.set("airport", airport);

    // Dates -> YYYY-MM-DD (timezone-safe)
    const fmt = (d?: Date | null) =>
      d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null;
    const checkIn = fmt(payload?.checkIn ?? payload?.dateRange?.from ?? null);
    const checkOut = fmt(payload?.checkOut ?? payload?.dateRange?.to ?? null);
    if (checkIn) params.set("checkIn", checkIn);
    if (checkOut) params.set("checkOut", checkOut);
    if (payload?.checkInTime) params.set("checkInTime", payload.checkInTime);
    if (payload?.checkOutTime) params.set("checkOutTime", payload.checkOutTime);
    if (payload?.bookingUnit) params.set("bookingUnit", payload.bookingUnit);

    // Guests
    const g = payload?.guests || {};
    const adults = Number(g.adults || 0);
    const children = Number(g.children || 0);
    const infants = Number(g.infants || 0);
    const pets = Number(g.pets || 0);
    const guests = adults + children; // common convention excludes infants/pets
    params.set("adults", String(adults));
    params.set("children", String(children));
    params.set("infants", String(infants));
    params.set("pets", String(pets));
    if (guests > 0) params.set("guests", String(guests));

    // Navigate to /search with all params
    router.push(`/search?${params.toString()}`);
  };

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      setSessionUser(user);
      if (user) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("full_name, avatar_url, role_host, role_guest")
          .eq("id", user.id)
          .single();

        const fallbackAvatar =
          user.user_metadata?.avatar_url ??
          user.user_metadata?.picture ??
          null;

        setProfile(
          profileData
            ? {
                full_name: profileData.full_name ?? user.email ?? null,
                avatar_url: profileData.avatar_url ?? fallbackAvatar,
                role_host: Boolean(profileData.role_host),
                role_guest: Boolean(profileData.role_guest),
              }
            : {
                full_name: user.email ?? null,
                avatar_url: fallbackAvatar,
                role_host: false,
                role_guest: false,
              }
        );
      } else {
        setProfile(null);
        setNotifications(0);
      }
    })();
  }, []);

  useEffect(() => {
    if (!sessionUser) return;

    const fetchNotifications = async () => {
      try {
        if (profile?.role_host) {
          const { count, error } = await supabase
            .from("bookings")
            .select("id", { count: "exact", head: true })
            .eq("host_id", sessionUser.id)
            .eq("status", "pending");
          if (!error) setNotifications(count ?? 0);
        } else if (profile?.role_guest) {
          const { count, error } = await supabase
            .from("bookings")
            .select("id", { count: "exact", head: true })
            .eq("guest_id", sessionUser.id)
            .eq("status", "awaiting_payment");
          if (!error) setNotifications(count ?? 0);
        } else {
          setNotifications(0);
        }
      } catch (err) {
        console.error("Failed to fetch notifications", err);
      }
    };

    fetchNotifications();
  }, [sessionUser, profile]);

  // --- Render --------------------------------------------------------------
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <AppHeader
        notificationCount={notifications}
        initialProfile={profile}
        onSignOut={async () => {
          await supabase.auth.signOut();
          router.push("/login");
        }}
      />

      <section className="border-b border-[#0B0D10] bg-[#0B0D10] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-300">
              Avyro
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-white md:text-5xl lg:text-6xl">
              Professional stays,
              <span className="block">
                <span className="line-through">without</span> ambiguity.
              </span>
            </h1>
            <p className="mt-4 text-sm text-slate-200 md:text-base">
              Nightly and day‑use accommodation built for operational schedules.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <div className="w-full max-w-[520px] overflow-hidden rounded-3xl border border-white/10 bg-black/20 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
              <img
                src="/hero-avyro.png"
                alt="Pilot arriving at a professional stay"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-8 w-full max-w-5xl px-4 pb-6">
        <SearchBar onSearch={onSearchBar} />
      </div>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Choose stay type",
              body: "Overnight or day‑use, aligned to your schedule.",
            },
            {
              title: "Enforced booking rules",
              body: "Listings only accept the mode the host sets.",
            },
            {
              title: "Built for repeat crews",
              body: "Clear pricing and reliable availability every trip.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-2 text-sm text-slate-600">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Enforced stay types
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Clear pricing
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Professional focus
            </span>
          </div>
          <span className="text-xs text-slate-500">
            Designed for aviation crews and operational teams.
          </span>
        </div>
      </section>

      {/* Category headings and horizontal scroll sections */}
      <div className="mx-auto max-w-7xl px-4 py-8">
        <SectionCategory
          title="Near airports"
          description="Reliable stays within easy reach of the terminal."
          listings={(filtered || [])
            .filter((listing: any) => listing.airport_code || listing.airportCode)
            .slice(0, 8)}
          signedUrls={signedUrls}
          emptyMessage="No airport stays yet. Check back soon."
        />
        <SectionCategory
          title="Day‑use stays"
          description="Hourly listings built for quick rest windows."
          listings={(filtered || [])
            .filter((listing: any) =>
              listing.booking_unit === "hourly" ||
              listing.bookingUnit === "hourly" ||
              listing.rental_type === "day_use" ||
              listing.rental_type === "split_rest"
            )
            .slice(0, 8)}
          signedUrls={signedUrls}
          emptyMessage="No day‑use listings yet. Try overnight stays for now."
        />
        <SectionCategory
          title="Extended stays"
          description="Longer nightly stays for repeat rotations."
          listings={(filtered || [])
            .filter((listing: any) => listing.rental_type === "crashpad" || listing.rental_type === "extended_stay")
            .slice(0, 8)}
          signedUrls={signedUrls}
          emptyMessage="No extended stays yet. New listings are coming soon."
        />
      </div>

      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="rounded-3xl border border-slate-200 bg-slate-900 px-6 py-8 text-white shadow-sm md:flex md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Host with Avyro</p>
            <h2 className="mt-3 text-2xl font-semibold">
              Become a trusted host for professional crews.
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Set your stay type, price once, and let Avyro enforce the rules.
            </p>
          </div>
          <button
            onClick={() => router.push("/host/create-listing")}
            className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 md:mt-0"
          >
            Become a host
          </button>
        </div>
      </section>

      <footer className="border-t border-[#0B0D10] bg-[#0B0D10] text-slate-200">
        <div
          className="relative"
          style={{ backgroundImage: "url('/footer-runway.svg')", backgroundSize: "cover", backgroundPosition: "center" }}
        >
          <div className="absolute inset-0 bg-[#0B0D10]/85" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-400">
                Avyro platform
              </p>
              <h2 className="mt-4 text-3xl font-semibold text-white md:text-4xl">
                Operational stays for crews and teams.
              </h2>
              <p className="mt-3 text-sm text-slate-300">
                Purpose‑built accommodation with enforced booking types and clear pricing.
              </p>
              <button
                onClick={() => router.push("/search")}
                className="mt-6 rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                Explore stays
              </button>
            </div>
            <div className="grid gap-8 sm:grid-cols-2">
              {[
                {
                  title: "Product",
                  links: ["Search stays", "Day-use stays", "Extended stays", "Airport hubs", "Pricing"],
                },
                {
                  title: "Hosts",
                  links: ["Become a host", "Host dashboard", "Calendar tools", "Payouts", "Pricing controls"],
                },
                {
                  title: "Company",
                  links: ["About Avyro", "Careers", "Press", "Security", "Privacy"],
                },
                {
                  title: "Support",
                  links: ["Help center", "Contact support", "Cancellation policy", "Trust & safety", "Accessibility"],
                },
              ].map((group) => (
                <div key={group.title}>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                    {group.title}
                  </p>
                  <ul className="mt-4 space-y-2 text-sm text-slate-200">
                    {group.links.map((link) => (
                      <li key={link}>
                        <span className="hover:text-white">{link}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-6 text-xs text-slate-400">
            <span>© 2026 Avyro. All rights reserved.</span>
            <span>United Kingdom · Europe</span>
          </div>
        </div>
      </footer>

      {/* Remove old results grid; handled in category sections above */}
    </main>
  );
}
// --- Category Section Component ---
type SectionCategoryProps = {
  title: string;
  description?: string;
  listings: any[];
  signedUrls: Record<string, string>;
  emptyMessage?: string;
};

function SectionCategory({
  title,
  description,
  listings,
  signedUrls,
  emptyMessage,
}: SectionCategoryProps) {
  return (
    <section className="mb-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {listings.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{emptyMessage ?? "No listings available."}</p>
      ) : (
        <div className="mt-4 flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
          {listings.map((listing: any) => {
            const imageUrl = pickImageUrl(listing, signedUrls);
            const title = listing.title || listing.name || "Untitled listing";
            const rating = toNumber(listing.review_overall ?? listing.reviewOverall);
            const reviewCount = toNumber(listing.review_total ?? listing.reviewTotal);
            const ratingLabel = rating != null ? formatReviewLabel(rating) : undefined;
            const meta = buildMetaLine(listing);
            const badgeText = getBadgeText(listing);

            return (
              <div key={listing.id} className="snap-start">
                <HomeListingCard
                  id={listing.id}
                  title={title}
                  imageUrl={imageUrl}
                  badgeText={badgeText}
                  rating={rating ?? undefined}
                  ratingLabel={ratingLabel ?? undefined}
                  reviewCount={reviewCount ?? undefined}
                  meta={meta ?? undefined}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
