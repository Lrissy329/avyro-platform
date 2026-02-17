import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { motion } from "framer-motion";

type HostQuote = {
  currency: "GBP";
  host_net_nightly_pence: number;
  guest_unit_price_pence: number;
  platform_fee_est_pence: number;
  platform_fee_capped: boolean;
  stripe_fee_est_pence: number;
  platform_margin_est_pence: number;
  platform_fee_bps: number;
  stripe_var_bps: number;
  stripe_fixed_pence: number;
  pricing_version: string;
};

const formatGBP = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatGBPExact = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const SECTION_ANIM = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: "easeOut" },
  viewport: { once: true, amount: 0.2 },
};

export default function HostStanstedLanding() {
  const [scrolled, setScrolled] = useState(false);
  const [hostRate, setHostRate] = useState(60);
  const [nightsPerMonth, setNightsPerMonth] = useState(18);
  const [quote, setQuote] = useState<HostQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const hostNetNightlyPence = Math.max(1, Math.round(hostRate)) * 100;
      setQuoteLoading(true);
      try {
        const resp = await fetch("/api/pricing/host-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hostNetNightlyPence,
            nights: nightsPerMonth,
            isFirstCompletedBooking: false,
          }),
        });
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload?.error ?? "Failed to fetch quote.");
        if (!cancelled) setQuote(payload);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hostRate, nightsPerMonth]);

  const guestPaysPerNight = quote ? quote.guest_unit_price_pence / 100 : null;
  const stripeFeeEstimate = quote ? quote.stripe_fee_est_pence / 100 : null;
  const monthlyNet = useMemo(() => hostRate * nightsPerMonth, [hostRate, nightsPerMonth]);
  const annualNet = monthlyNet * 12;
  const ringRatio = useMemo(() => {
    if (!guestPaysPerNight || guestPaysPerNight <= 0) return 0.78;
    return Math.min(0.92, Math.max(0.45, hostRate / guestPaysPerNight));
  }, [guestPaysPerNight, hostRate]);

  const ringCircumference = 2 * Math.PI * 44;
  const ringOffset = ringCircumference * (1 - ringRatio);

  return (
    <>
      <Head>
        <title>Host near Stansted · Avyro</title>
      </Head>

      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header
          className={`sticky top-0 z-40 transition ${
            scrolled
              ? "backdrop-blur-xl bg-white/80 border-b border-slate-200 shadow-sm"
              : "bg-transparent"
          }`}
        >
          <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-4">
            <div className="text-sm font-semibold tracking-[0.2em] uppercase text-slate-700">
              Avyro · Stansted
            </div>
            <nav className="flex items-center gap-6 text-sm text-slate-600">
              <a href="#earnings" className="hover:text-slate-900">Earnings</a>
              <a href="#pricing" className="hover:text-slate-900">Pricing</a>
              <a href="#zone" className="hover:text-slate-900">STN zone</a>
              <Link
                href="/host/create-listing"
                className="rounded-full bg-[#FEDD02] px-4 py-2 text-sm font-semibold text-black shadow-sm hover:shadow-md"
              >
                Start hosting
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[1280px] px-6 pb-24 pt-14">
          <motion.section
            {...SECTION_ANIM}
            className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">
                Stansted crew demand
              </p>
              <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
                Turn spare rooms into consistent crew income—calm, premium, and predictable.
              </h1>
              <p className="mt-5 text-lg text-slate-600">
                Avyro helps hosts near STN earn more with clear pricing, instant booking, and crew-ready demand.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/host/create-listing"
                  className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:shadow-md"
                >
                  List my space
                </Link>
                <Link
                  href="/host/dashboard"
                  className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-white"
                >
                  View host dashboard
                </Link>
              </div>

              <div className="mt-10 flex flex-wrap gap-3">
                {[
                  "Tiered commission (12% → 10% → 8%)",
                  "£150 fee cap per booking",
                  "First completed booking free",
                ].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-xs text-slate-500">
                Processing fees still apply on every booking.
              </p>
            </div>

            <div className="relative">
              <div className="absolute -top-10 right-8 h-48 w-48 rounded-full bg-[radial-gradient(circle_at_center,rgba(254,221,2,0.25),transparent_60%)]" />
              <div className="absolute -bottom-14 right-24 h-56 w-56 rounded-full bg-[radial-gradient(circle_at_center,rgba(15,23,42,0.12),transparent_65%)]" />

              <div className="relative space-y-4">
                <motion.div
                  whileHover={{ y: -4 }}
                  className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Earnings</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">
                    {formatGBP(monthlyNet)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    projected monthly at {nightsPerMonth} nights
                  </p>
                </motion.div>

                <motion.div
                  whileHover={{ y: -4 }}
                  className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Pricing</p>
                  <div className="mt-3 flex items-baseline justify-between">
                    <div>
                      <p className="text-sm text-slate-500">Guest pays</p>
                      <p className="text-2xl font-semibold text-slate-900">
                        {guestPaysPerNight ? formatGBP(guestPaysPerNight) : "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-500">You receive</p>
                      <p className="text-2xl font-semibold text-slate-900">
                        {formatGBP(hostRate)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    Rounded guest price · includes all fees
                  </p>
                </motion.div>
              </div>
            </div>
          </motion.section>

          <motion.section
            {...SECTION_ANIM}
            id="earnings"
            className="mt-24 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]"
          >
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Earnings simulator</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-900">Model your crew income.</h2>
              <p className="mt-2 text-sm text-slate-500">
                Adjust your nightly target and expected occupied nights. Prices update instantly.
              </p>

              <div className="mt-8 space-y-6">
                <div>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>Nightly rate you receive</span>
                    <span className="font-semibold text-slate-900">{formatGBP(hostRate)}</span>
                  </div>
                  <input
                    type="range"
                    min={40}
                    max={180}
                    step={1}
                    value={hostRate}
                    onChange={(e) => setHostRate(Number(e.target.value))}
                    className="mt-3 w-full accent-[#FEDD02]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>Nights booked per month</span>
                    <span className="font-semibold text-slate-900">{nightsPerMonth} nights</span>
                  </div>
                  <input
                    type="range"
                    min={6}
                    max={28}
                    step={1}
                    value={nightsPerMonth}
                    onChange={(e) => setNightsPerMonth(Number(e.target.value))}
                    className="mt-3 w-full accent-[#FEDD02]"
                  />
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Guest pays</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {guestPaysPerNight ? formatGBP(guestPaysPerNight) : "—"}
                  </p>
                  <p className="text-xs text-slate-500">rounded price per night</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Processing est.</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {stripeFeeEstimate != null ? formatGBPExact(stripeFeeEstimate) : "—"}
                  </p>
                  <p className="text-xs text-slate-500">per booking</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Net monthly</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {formatGBP(monthlyNet)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Net annual</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {formatGBP(annualNet)}
                  </p>
                </div>
              </div>
              {quoteLoading && <p className="mt-4 text-xs text-slate-400">Updating pricing…</p>}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Earnings mix</p>
              <div className="mt-8 flex flex-col items-center justify-center">
                <svg width="140" height="140" className="drop-shadow-sm">
                  <circle
                    cx="70"
                    cy="70"
                    r="44"
                    stroke="#E2E8F0"
                    strokeWidth="12"
                    fill="none"
                  />
                  <circle
                    cx="70"
                    cy="70"
                    r="44"
                    stroke="#0F172A"
                    strokeWidth="12"
                    fill="none"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    strokeLinecap="round"
                    transform="rotate(-90 70 70)"
                  />
                </svg>
                <p className="mt-6 text-sm text-slate-500">Host share of guest price</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {guestPaysPerNight ? `${Math.round(ringRatio * 100)}%` : "—"}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Tiered commission and fee cap keep long stays efficient.
                </p>
              </div>
              <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                First completed booking is commission-free (processing fees still apply).
              </div>
            </div>
          </motion.section>

          <motion.section {...SECTION_ANIM} id="pricing" className="mt-24">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Pricing</p>
                  <h2 className="mt-3 text-3xl font-semibold text-slate-900">Simple, tiered commission.</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    We don’t penalise long stays. Your first completed booking is commission-free.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
                  <p>Commission capped at £150 per booking.</p>
                </div>
              </div>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {[
                  { label: "1–6 nights", value: "12%" },
                  { label: "7–27 nights", value: "10%" },
                  { label: "28+ nights", value: "8%" },
                ].map((tier) => (
                  <div key={tier.label} className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{tier.label}</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900">{tier.value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-xs text-slate-500">
                First completed booking: platform commission £0 (processing fees still apply).
              </p>
            </div>
          </motion.section>

          <motion.section {...SECTION_ANIM} id="zone" className="mt-24">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center">
              <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">STN zone</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-900">
                  25‑minute radius from Stansted.
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  We prioritise listings within the crew commute zone. Check if your place qualifies.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {["Bishop’s Stortford", "Harlow", "Sawbridgeworth", "Stansted Mountfitchet", "Ware"].map((town) => (
                    <span key={town} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                      {town}
                    </span>
                  ))}
                </div>
                <button className="mt-8 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white">
                  Check if I’m in the zone
                </button>
              </div>

              <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-100 via-white to-slate-200 p-6 shadow-sm">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(254,221,2,0.2),transparent_55%)]" />
                <div className="relative h-[320px] rounded-2xl border border-slate-200 bg-white/70">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-48 w-48 rounded-full border-2 border-dashed border-slate-400/60" />
                    <div className="absolute h-5 w-5 rounded-full bg-slate-900" />
                  </div>
                  <div className="absolute bottom-4 left-4 rounded-full bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
                    25‑min commute zone
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        </main>
      </div>
    </>
  );
}
