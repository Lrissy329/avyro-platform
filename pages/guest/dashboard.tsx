import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/ensureProfile";
import { ListingCard } from "@/components/ListingCard";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { MessagesPanel } from "@/components/MessagesPanel";
import { AppHeader } from "@/components/AppHeader";
import type { Listing } from "@/types/Listing";

type BookingStatus =
  | "pending"
  | "awaiting_payment"
  | "approved"
  | "paid"
  | "confirmed"
  | "payment_failed"
  | "declined"
  | "cancelled";

type GuestBooking = {
  id: string;
  listing_id: string;
  host_id?: string | null;
  status: BookingStatus;
  check_in: string | null;
  check_out: string | null;
  guests_total: number | null;
  price_total: number | null;
  currency: string | null;
  created_at: string;
};

type ListingRow = {
  id: string;
  title: string;
  location: string | null;
  price_per_night: number | null;
  price_per_hour?: number | null;
  booking_unit?: "nightly" | "hourly" | null;
  user_id?: string | null;
  listing_type: Listing["listing_type"] | null;
  type?: string | null;
  is_shared_booking_allowed: boolean | null;
  photos: string[] | null;
  thumbnail?: string | null;
};

const BUCKET = "listing-photos";

const toPublicUrl = (pathOrUrl?: string | null): string | null => {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const key = pathOrUrl.startsWith("/") ? pathOrUrl.slice(1) : pathOrUrl;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data?.publicUrl ?? null;
};

const firstPhoto = (photos?: string[] | null): string | null => {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  for (const raw of photos) {
    const resolved = toPublicUrl(raw);
    if (resolved) return resolved;
  }
  return null;
};

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export default function GuestDashboard() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<GuestBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingLookup, setListingLookup] = useState<Record<string, ListingRow>>({});
  const [guestId, setGuestId] = useState<string | null>(null);
  const [payingBookingId, setPayingBookingId] = useState<string | null>(null);

  const getQueryValue = (key: string) =>
    typeof router.query[key] === "string" ? (router.query[key] as string) : "";

  const stayWindow = useMemo(() => {
    const checkIn = getQueryValue("checkIn");
    const checkOut = getQueryValue("checkOut");
    if (!checkIn || !checkOut) return null;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const checkInTime = getQueryValue("checkInTime");
    const checkOutTime = getQueryValue("checkOutTime");
    if (checkInTime) {
      const [h, m] = checkInTime.split(":").map(Number);
      if (Number.isFinite(h)) start.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
    }
    if (checkOutTime) {
      const [h, m] = checkOutTime.split(":").map(Number);
      if (Number.isFinite(h)) end.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
    }
    const durationMs = end.getTime() - start.getTime();
    if (durationMs <= 0) return null;
    return { durationMs, hasTimeSelection: Boolean(checkInTime || checkOutTime) };
  }, [router.query]);

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

  const getStaySummary = (listing: ListingRow) => {
    const bookingUnit = listing.booking_unit === "hourly" ? "hourly" : "nightly";
    if (bookingUnit === "hourly") {
      return stayWindow?.hasTimeSelection && stayHours > 0
        ? { units: stayHours, unitLabel: "hour" as const }
        : null;
    }
    return stayNights > 0 ? { units: stayNights, unitLabel: "night" as const } : null;
  };

  const loadBookings = async (guestId: string) => {
    setBookingsLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        listing_id,
        host_id,
        status,
        check_in,
        check_out,
        guests_total,
        price_total,
        currency,
        created_at
      `
      )
      .eq("guest_id", guestId)
      .order("check_in", { ascending: true });

    if (error) {
      console.error("Failed to load bookings:", error.message);
      setBookings([]);
      setBookingsLoading(false);
      return;
    }

    const rows = (data as GuestBooking[]) ?? [];
    setBookings(rows);

    const uniqueListingIds = Array.from(
      new Set(rows.map((booking) => booking.listing_id).filter(Boolean))
    ) as string[];

    const missingIds = uniqueListingIds.filter((id) => !listingLookup[id]);
    if (missingIds.length > 0) {
      const { data: listingRows, error: listingErr } = await supabase
        .from("listings")
        .select(
          "id, title, location, price_per_night, price_per_hour, booking_unit, listing_type, type, is_shared_booking_allowed, photos, user_id"
        )
        .in("id", missingIds);

      if (listingErr) {
        console.error("Failed to load booking listings:", listingErr.message);
      } else if (listingRows) {
        const enriched = (listingRows as ListingRow[]).map((listing) => ({
          ...listing,
          thumbnail: firstPhoto(listing.photos) ?? "/placeholder.jpg",
        }));

        setListingLookup((prev) => {
          const next = { ...prev };
          enriched.forEach((entry) => {
            next[entry.id] = entry;
          });
          return next;
        });

        setListings((prev) => {
          const map = new Map<string, ListingRow>();
          [...prev, ...enriched].forEach((entry) => {
            map.set(entry.id, entry);
          });
          return Array.from(map.values());
        });
      }
    }

    setBookingsLoading(false);
  };

  const clearBookingHistory = async (guestId: string) => {
    const confirmed = window.confirm(
      "This will permanently remove all of your bookings from history. Continue?"
    );
    if (!confirmed) return;

    setBookingsLoading(true);
    const { error } = await supabase.from("bookings").delete().eq("guest_id", guestId);

    if (error) {
      console.error("Failed to clear bookings:", error.message);
      alert("Could not clear bookings. Please try again.");
    } else {
      setBookings([]);
    }
    setBookingsLoading(false);
  };

  const loadListings = async () => {
    setListingsLoading(true);
    const { data, error } = await supabase
      .from("listings")
      .select(
        "id, title, location, price_per_night, price_per_hour, booking_unit, listing_type, type, is_shared_booking_allowed, photos, user_id"
      )
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) {
      console.error("Failed to load listings:", error.message);
      setListings([]);
    } else {
      const enriched = (data as ListingRow[] | null)?.map((listing) => ({
        ...listing,
        thumbnail: firstPhoto(listing.photos) ?? "/placeholder.jpg",
      }));
      setListings(enriched ?? []);
      if (enriched) {
        setListingLookup((prev) => {
          const next = { ...prev };
          enriched.forEach((entry) => {
            next[entry.id] = entry;
          });
          return next;
        });
      }
    }
    setListingsLoading(false);
  };

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        router.push("/login");
        return;
      }

      await ensureProfile();

      const { data: profile } = await supabase
        .from("profiles")
        .select("role_guest")
        .eq("id", user.id)
        .single();

      if (!profile?.role_guest) {
        router.push("/host/dashboard");
        return;
      }

      setUserEmail(user.email);
      setGuestId(user.id);
      await Promise.all([loadBookings(user.id), loadListings()]);
      setLoading(false);
    };

    load();
  }, []);

  const today = useMemo(() => new Date(), []);

  const resumePayment = async (booking: GuestBooking) => {
    if (!guestId) {
      alert("You must be logged in to complete payment.");
      return;
    }
    const listing = listingLookup[booking.listing_id];
    const hostId = booking.host_id ?? listing?.user_id ?? undefined;

    setPayingBookingId(booking.id);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const resp = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: booking.id,
          listingId: booking.listing_id,
          hostId,
          guestId,
          successUrl: `${origin}/booking/success?booking=${booking.id}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/guest/dashboard?booking=${booking.id}`,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error ?? "Unable to start checkout.");
      }
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      alert("Checkout session started, but no redirect URL was returned.");
    } catch (err: any) {
      console.error("Failed to resume payment", err);
      alert(err?.message ?? "Unable to resume payment. Please try again.");
    } finally {
      setPayingBookingId(null);
    }
  };

  const awaitingPaymentTrips = useMemo(
    () =>
      bookings.filter(
        (booking) =>
          booking.status === "awaiting_payment" ||
          booking.status === "approved" ||
          booking.status === "payment_failed"
      ),
    [bookings]
  );

  const upcomingTrips = useMemo(
    () =>
      bookings.filter((booking) => {
        if (booking.status !== "paid" && booking.status !== "confirmed") return false;
        if (!booking.check_out) return true;
        const out = new Date(booking.check_out);
        return !Number.isNaN(out.getTime()) && out >= today;
      }),
    [bookings, today]
  );

  const pendingRequests = useMemo(
    () => bookings.filter((booking) => booking.status === "pending"),
    [bookings]
  );

  const pastTrips = useMemo(
    () =>
      bookings.filter((booking) => {
        if (booking.status !== "paid" && booking.status !== "confirmed") return false;
        if (!booking.check_out) return false;
        const out = new Date(booking.check_out);
        return !Number.isNaN(out.getTime()) && out < today;
      }),
    [bookings, today]
  );

  if (loading) {
    return <main className="min-h-screen bg-slate-50 p-6 text-gray-700">Loading guest dashboard…</main>;
  }

  const renderBookingCard = (booking: GuestBooking) => {
    const listing = listingLookup[booking.listing_id];
    const cover = listing?.thumbnail ?? firstPhoto(listing?.photos) ?? "/placeholder.jpg";
    return (
      <div
        key={booking.id}
        className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition overflow-hidden"
      >
        <div className="h-44 w-full overflow-hidden">
          <img src={cover} alt={listing?.title ?? "Listing"} className="h-full w-full object-cover" />
        </div>
        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              {listing?.title ?? "Listing unavailable"}
            </h3>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[booking.status]}`}
            >
              {STATUS_LABEL[booking.status]}
            </span>
          </div>
          <p className="text-sm text-gray-600">{listing?.location ?? "Location unavailable"}</p>
          <p className="text-sm text-gray-700">
            <span className="font-medium">Dates:</span> {formatDate(booking.check_in)} –{" "}
            {formatDate(booking.check_out)}
          </p>
          {booking.guests_total ? (
            <p className="text-sm text-gray-700">
              <span className="font-medium">Guests:</span>{" "}
              <span className="font-mono tabular-nums">{booking.guests_total}</span>
            </p>
          ) : null}
          {booking.price_total ? (
            <p className="text-sm text-gray-700">
              <span className="font-medium">Total:</span>{" "}
              <span className="font-mono tabular-nums">
                {booking.currency ?? "GBP"} {booking.price_total}
              </span>
            </p>
          ) : null}
          {booking.status === "awaiting_payment" ||
          booking.status === "approved" ||
          booking.status === "payment_failed" ? (
            <button
              type="button"
              onClick={() => resumePayment(booking)}
              disabled={payingBookingId === booking.id}
              className="inline-flex w-full items-center justify-center rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {payingBookingId === booking.id ? "Redirecting…" : "Complete payment"}
            </button>
          ) : null}
          {listing?.id ? (
            <Link
              href={`/listing/${listing.id}`}
              className="inline-flex items-center text-sm font-medium text-[#FEDD02] hover:text-[#E6C902]"
            >
              View listing →
            </Link>
          ) : null}
        </div>
      </div>
    );
  };

  const renderSection = (
    title: string,
    emptyMessage: string,
    items: GuestBooking[],
    loadingState: boolean
  ) => (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      </div>
      {loadingState ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-600">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map(renderBookingCard)}
        </div>
      )}
    </section>
  );

  return (
    <main className="min-h-screen bg-slate-50 text-gray-900">
      <AppHeader />
      <header className="bg-black border-b border-black">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-100">Guest dashboard</p>
            <h1 className="text-3xl font-semibold mt-1 text-white">
              Welcome back{userEmail ? `, ${userEmail}` : ""}
            </h1>
          </div>
          <RoleSwitcher tone="dark" />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">
        <section className="bg-black text-white rounded-3xl p-8 shadow-lg">
          <h2 className="text-2xl font-semibold mb-2">Plan your next airport stay</h2>
          <p className="text-white/80 max-w-2xl">
            Explore host pads tailored for airline crew and airport teams. Keep an eye on your
            upcoming trips and pending requests below.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/search"
              className="inline-flex items-center px-4 py-2.5 rounded-full bg-white text-gray-900 font-medium hover:bg-gray-100 transition"
            >
              Start searching
            </Link>
            <Link
              href="/guest/dashboard#explore"
              className="inline-flex items-center px-4 py-2.5 rounded-full border border-white/60 text-white font-medium hover:bg-white/10 transition"
            >
              View featured stays
            </Link>
          </div>
        </section>

        <div className="flex items-center justify-end">
          <button
            onClick={() => guestId && clearBookingHistory(guestId)}
            disabled={bookingsLoading || bookings.length === 0}
            className="text-sm font-medium text-red-600 hover:text-red-700 border border-red-600/60 rounded-full px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear booking history
          </button>
        </div>

        {renderSection(
          "Awaiting payment",
          "Bookings that are ready for checkout will appear here.",
          awaitingPaymentTrips,
          bookingsLoading
        )}

        {renderSection(
          "Upcoming stays",
          "Paid bookings scheduled for the future will appear here.",
          upcomingTrips,
          bookingsLoading
        )}

        {renderSection(
          "Pending requests",
          "You currently have no booking requests waiting on host approval.",
          pendingRequests,
          bookingsLoading
        )}

        {renderSection(
          "Past stays",
          "Completed paid trips will show here after check-out.",
          pastTrips,
          bookingsLoading
        )}

        <section id="explore" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Explore available pads</h2>
            <Link href="/search" className="text-sm font-medium text-[#FEDD02] hover:text-[#E6C902]">
              Browse all →
            </Link>
          </div>
          {listingsLoading ? (
            <p className="text-sm text-gray-600">Loading listings…</p>
          ) : listings.length === 0 ? (
            <p className="text-sm text-gray-600">
              No listings available yet. Check back soon or adjust your search.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {listings.map((listing) => (
                <Link key={listing.id} href={`/listing/${listing.id}`} className="block">
                  <ListingCard
                    listing={{
                      ...listing,
                      thumbnail: listing.thumbnail ?? undefined,
                      photos: listing.photos,
                    }}
                    staySummary={getStaySummary(listing)}
                  />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Messages</h2>
          <MessagesPanel role="guest" />
        </section>
      </div>
    </main>
  );
}
const STATUS_BADGE: Record<BookingStatus, string> = {
  pending: "bg-[#0B0D10]/5 text-[#4B5563]",
  awaiting_payment: "bg-[#0B0D10]/5 text-[#4B5563]",
  approved: "bg-[#0B0D10]/5 text-[#4B5563]",
  paid: "bg-[#14FF62]/20 text-[#0B0D10]",
  confirmed: "bg-[#14FF62]/20 text-[#0B0D10]",
  payment_failed: "bg-[#E5484D]/10 text-[#E5484D]",
  declined: "bg-[#E5484D]/10 text-[#E5484D]",
  cancelled: "bg-[#0B0D10]/5 text-[#4B5563]",
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pending",
  awaiting_payment: "Awaiting payment",
  approved: "Awaiting payment",
  paid: "Confirmed",
  confirmed: "Confirmed",
  payment_failed: "Payment failed",
  declined: "Declined",
  cancelled: "Cancelled",
};
