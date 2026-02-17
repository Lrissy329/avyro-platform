import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type BookingRow = {
  id: string;
  status: string | null;
  payout_status: string | null;
  check_in: string | null;
  check_out: string | null;
  price_total: number | null;
  currency: string | null;
  listing: {
    id: string;
    title: string | null;
    location: string | null;
    photos: string[] | null;
  } | null;
};

type BookingRowFromSupabase = Omit<BookingRow, "listing"> & {
  listing: BookingRow["listing"] | BookingRow["listing"][] | null;
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
  if (!Array.isArray(photos)) return null;
  for (const photo of photos) {
    const resolved = toPublicUrl(photo);
    if (resolved) return resolved;
  }
  return null;
};

const formatRangeSummary = (checkIn?: string | null, checkOut?: string | null) => {
  if (!checkIn || !checkOut) return null;
  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  if (Number.isNaN(inDate.getTime()) || Number.isNaN(outDate.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return `${formatter.format(inDate)} – ${formatter.format(outDate)}`;
};

const toGoogleDate = (value: Date) => {
  return value.toISOString().slice(0, 10).replace(/-/g, "");
};

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const escapeICS = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");

export default function BookingSuccessPage() {
  const router = useRouter();
  const { booking: bookingId, session_id: sessionId } = router.query;
  const [booking, setBooking] = useState<BookingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [resolvedBookingId, setResolvedBookingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof bookingId === "string") {
      setResolvedBookingId(bookingId);
    }
  }, [bookingId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!resolvedBookingId) {
      setLoading(false);
      return;
    }
    if (syncState === "syncing") return;

    const fetchBooking = async () => {
      try {
        const resp = await fetch(`/api/bookings/${resolvedBookingId}`);
        const payload = await resp.json();
        if (!resp.ok) {
          throw new Error(payload?.error ?? "Unable to load booking");
        }
        const data = payload.booking as BookingRowFromSupabase;
        if (!data) {
          setBooking(null);
          return;
        }
        const listing =
          Array.isArray(data.listing) && data.listing.length > 0
            ? data.listing[0]
            : Array.isArray(data.listing)
            ? null
            : data.listing;
        setBooking({
          ...data,
          listing,
        });
      } catch (err) {
        console.error("Failed to fetch booking", err);
        setBooking(null);
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [resolvedBookingId, syncState, router.isReady]);

  useEffect(() => {
    if (!sessionId || typeof sessionId !== "string") return;
    setSyncState("syncing");
    const run = async () => {
      try {
        const resp = await fetch(`/api/stripe/confirm-session?session_id=${sessionId}`);
        const payload = await resp.json();
        if (!resp.ok) {
          throw new Error(payload?.error ?? "Failed to confirm payment.");
        }
        if (payload?.bookingId && typeof payload.bookingId === "string") {
          setResolvedBookingId(payload.bookingId);
        }
        setSyncState("done");
      } catch (err) {
        console.error("Failed to confirm checkout session", err);
        setSyncState("error");
      }
    };
    run();
  }, [sessionId]);

  const heroPhoto = useMemo(
    () => firstPhoto(booking?.listing?.photos) ?? "/placeholder.jpg",
    [booking?.listing?.photos]
  );

  const rangeSummary = useMemo(
    () => formatRangeSummary(booking?.check_in, booking?.check_out),
    [booking?.check_in, booking?.check_out]
  );

  const googleCalendarUrl = useMemo(() => {
    if (!booking?.check_in || !booking?.check_out) return null;
    const start = new Date(booking.check_in);
    const end = new Date(booking.check_out);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const endExclusive = addDays(end, 1);
    const summary = booking.listing?.title ? `Stay at ${booking.listing.title}` : "Aeronooc stay";
    const details = `Aeronooc booking ${booking.id}`;
    const location = booking.listing?.location ?? "";
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", summary);
    url.searchParams.set("dates", `${toGoogleDate(start)}/${toGoogleDate(endExclusive)}`);
    url.searchParams.set("details", details);
    if (location) url.searchParams.set("location", location);
    return url.toString();
  }, [booking]);

  const handleDownloadIcs = () => {
    if (!booking?.check_in || !booking?.check_out) return;
    const start = new Date(booking.check_in);
    const end = new Date(booking.check_out);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const endExclusive = addDays(end, 1);
    const summary = booking.listing?.title ? `Stay at ${booking.listing.title}` : "Aeronooc stay";
    const location = booking.listing?.location ?? "Aeronooc stay";
    const now = new Date();
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Aeronooc//Booking//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:booking-${booking.id}@aeronooc`,
      `DTSTAMP:${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      `DTSTART;VALUE=DATE:${toGoogleDate(start)}`,
      `DTEND;VALUE=DATE:${toGoogleDate(endExclusive)}`,
      `SUMMARY:${escapeICS(summary)}`,
      `LOCATION:${escapeICS(location)}`,
      `DESCRIPTION:${escapeICS(`Booking ${booking.id} via Aeronooc`)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aeronooc-booking-${booking?.id}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const renderDetails = () => {
    if (loading) {
      return <p className="text-sm text-gray-600">Loading booking details…</p>;
    }

    if (!booking) {
      return (
        <p className="text-sm text-gray-600">
          Thanks for your payment! We&apos;re finalising your booking
          {resolvedBookingId ? (
            <>
              {" "}
              (<code>{resolvedBookingId}</code>)
            </>
          ) : null}
          . Refresh in a moment or check your dashboard for confirmation.
        </p>
      );
    }

    const amountLabel =
      booking.price_total && booking.currency
        ? new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: booking.currency,
          }).format(booking.price_total)
        : null;

    const bookingStatusLabel =
      booking.status === "paid" || booking.status === "confirmed"
        ? "Confirmed"
        : booking.status === "awaiting_payment"
        ? "Awaiting payment"
        : booking.status === "payment_failed"
        ? "Payment failed"
        : booking.status ?? "pending";

    const payoutStatusLabel =
      booking.payout_status === "awaiting_payout"
        ? "Awaiting payout"
        : booking.payout_status ?? "pending";

    return (
      <>
        <dl className="mt-6 space-y-2 text-sm text-gray-700">
          {booking.listing?.title && (
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-gray-600">Listing</dt>
              <dd className="text-right">{booking.listing.title}</dd>
            </div>
          )}
          {booking.listing?.location && (
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-gray-600">Location</dt>
              <dd className="text-right">{booking.listing.location}</dd>
            </div>
          )}
          {booking.check_in && booking.check_out && (
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-gray-600">Dates</dt>
              <dd className="text-right">
                {new Date(booking.check_in).toLocaleDateString("en-GB")} –{" "}
                {new Date(booking.check_out).toLocaleDateString("en-GB")}
              </dd>
            </div>
          )}
          {amountLabel && (
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-gray-600">Total paid</dt>
              <dd className="text-right font-mono tabular-nums">{amountLabel}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="font-medium text-gray-600">Booking status</dt>
            <dd className="text-right">{bookingStatusLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="font-medium text-gray-600">Payout status</dt>
            <dd className="text-right">{payoutStatusLabel}</dd>
          </div>
        </dl>
        {booking.status === "paid" || booking.status === "confirmed" ? (
          <p className="mt-4 text-sm text-[#0B0D10] bg-[#14FF62]/15 border border-[#14FF62]/40 rounded-xl px-3 py-2">
            You’re all set—your reservation is confirmed and the host has been notified. You can
            manage the stay or message your host from your dashboard.
          </p>
        ) : booking.status === "payment_failed" ? (
          <p className="mt-4 text-sm text-[#E5484D] bg-[#E5484D]/10 border border-[#E5484D]/30 rounded-xl px-3 py-2">
            Your payment didn’t go through. Please try again from your dashboard.
          </p>
        ) : (
          <p className="mt-4 text-sm text-[#4B5563] bg-[#0B0D10]/5 border border-[#0B0D10]/10 rounded-xl px-3 py-2">
            We&apos;ve logged your payment and are waiting on the host to finalise the booking. Keep
            an eye on your dashboard for updates.
          </p>
        )}
      </>
    );
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="rounded-3xl bg-white shadow-xl border border-slate-200 px-8 py-10 space-y-10">
          <header>
            <div className="flex items-center gap-3 text-[#14FF62]">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#14FF62]/15">
                ✓
              </span>
              <h1 className="text-2xl font-semibold text-gray-900">Payment successful</h1>
            </div>
            <p className="mt-4 text-sm text-gray-600">
              Thanks for booking with Aeronooc! We&apos;ve reserved your stay and notified the host.
              You&apos;ll receive email confirmation shortly.
            </p>
            {sessionId && (
              <p className="mt-2 text-xs text-gray-500">
                Checkout session: <code className="font-mono">{sessionId}</code>
              </p>
            )}
            {syncState === "syncing" && (
              <p className="mt-2 text-xs text-[#4B5563]">
                Syncing your booking status…
              </p>
            )}
            {syncState === "error" && (
              <p className="mt-2 text-xs text-[#E5484D]">
                We couldn&apos;t verify the payment automatically. Your booking may take a moment to
                update in the dashboard.
              </p>
            )}
          </header>

          {booking && (
            <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-900/90 text-white shadow-lg">
                <div className="h-56 w-full overflow-hidden">
                  <img
                    src={heroPhoto}
                    alt={booking.listing?.title ?? "Listing photo"}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="p-6 space-y-3">
                  <p className="text-sm uppercase tracking-[0.3em] text-white/70">
                    Booking confirmed
                  </p>
                  <h2 className="text-2xl font-semibold">{booking.listing?.title ?? "Aeronooc stay"}</h2>
                  {booking.listing?.location && (
                    <p className="text-white/80">{booking.listing.location}</p>
                  )}
                  {rangeSummary && (
                    <p className="text-sm text-white/80">
                      <span className="font-semibold text-white">Dates:</span> {rangeSummary}
                    </p>
                  )}
                  {booking.price_total && booking.currency && (
                    <p className="text-sm text-white/80">
                      <span className="font-semibold text-white">Total paid:</span>{" "}
                      {new Intl.NumberFormat("en-GB", {
                        style: "currency",
                        currency: booking.currency,
                      }).format(booking.price_total)}
                    </p>
                  )}
                  <Link
                    href={`/listing/${booking.listing?.id ?? ""}`}
                    className="inline-flex items-center rounded-full bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur hover:bg-white/20"
                  >
                    View listing
                  </Link>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-inner">
                <h3 className="text-lg font-semibold text-slate-900">Sync this stay</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Add the reservation to your personal calendar so you never miss check-in.
                </p>
                <div className="mt-4 space-y-3">
                  <button
                    onClick={handleDownloadIcs}
                    className="w-full rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-900"
                  >
                    Add to Apple/Outlook (ICS)
                  </button>
                  {googleCalendarUrl && (
                    <a
                      href={googleCalendarUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-white"
                    >
                      Add to Google Calendar
                    </a>
                  )}
                  <Link
                    href="/guest/dashboard"
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-white"
                  >
                    View in dashboard
                  </Link>
                </div>
              </div>
            </div>
          )}

          <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
            {renderDetails()}
          </section>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/guest/dashboard"
              className="inline-flex items-center rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-900"
            >
              Go to your dashboard
            </Link>
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            >
              Explore more listings
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
