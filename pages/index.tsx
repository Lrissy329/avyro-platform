// pages/index.tsx
// Home — refined hero, search-first experience, category rows

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/router";
import SearchBar from "@/components/SearchBar";

const AIRPORT_MARKETPLACE_STAYS = [
  {
    id: "stn-quiet-1bed",
    title: "Quiet 1-bed near Stansted",
    description: "Reliable base for early starts and short turnarounds.",
    minutesToAirport: 10,
    airportCode: "STN",
    trustBadge: "Crew-ready",
    rating: 4.9,
    reviews: 23,
    pricePerNight: 65,
    imageUrl: "/placeholder.jpg",
    href: "/search?airport=STN",
  },
  {
    id: "lhr-modern-studio",
    title: "Modern studio near Heathrow",
    description: "Calm, practical stay with fast terminal access.",
    minutesToAirport: 14,
    airportCode: "LHR",
    trustBadge: "Verified",
    rating: 4.8,
    reviews: 31,
    pricePerNight: 79,
    imageUrl: "/placeholder.jpg",
    href: "/search?airport=LHR",
  },
  {
    id: "lgw-crew-flat",
    title: "Crew flat near Gatwick",
    description: "Professional-ready accommodation for repeat rotations.",
    minutesToAirport: 12,
    airportCode: "LGW",
    trustBadge: "Crew-ready",
    rating: 4.9,
    reviews: 18,
    pricePerNight: 72,
    imageUrl: "/placeholder.jpg",
    href: "/search?airport=LGW",
  },
] as const;

type DividerIconProps = {
  className?: string;
};

const DividerPinIcon = ({ className }: DividerIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <path d="M12 22s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z" />
    <circle cx="12" cy="10" r="2.8" />
  </svg>
);

const DividerShieldIcon = ({ className }: DividerIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <path d="M12 3 5 6v6c0 5 3.4 8.1 7 9 3.6-.9 7-4 7-9V6l-7-3Z" />
    <path d="m9.5 12 1.8 1.8 3.4-3.4" />
  </svg>
);

const DividerPriceIcon = ({ className }: DividerIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="M7 12h10" />
    <path d="M12 9v6" />
  </svg>
);

export default function Home() {
  const router = useRouter();

  const dividerRef = useRef<HTMLElement | null>(null);
  const [dividerVisible, setDividerVisible] = useState(false);

  useEffect(() => {
    const node = dividerRef.current;
    if (!node || dividerVisible) return;

    if (typeof IntersectionObserver === "undefined") {
      setDividerVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setDividerVisible(true);
        observer.disconnect();
      },
      { threshold: 0.25 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [dividerVisible]);

  // --- Render --------------------------------------------------------------
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 pb-16 pt-12 lg:px-8 lg:pb-24 lg:pt-20">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[46%_54%] lg:gap-16">
            <div className="relative z-20">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600">
                <span aria-hidden>✈</span>
                For professionals near airports
              </p>

              <h1 className="mt-5 max-w-[11ch] text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl lg:leading-[1.02]">
                Find{" "}
                <span className="relative inline-block">
                  <span className="relative z-[1]">reliable</span>
                  <span className="absolute bottom-1 left-0 z-0 h-2 w-full rounded bg-amber-200/65" />
                </span>{" "}
                stays near your workplace
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600 lg:text-xl">
                Quiet, reliable accommodation near airports and transport links — designed for
                professionals, not tourists.
              </p>

              <div className="relative z-20 mt-8 lg:w-[calc(100%+22rem)] xl:w-[calc(100%+24rem)]">
                <SearchBar onSearch={() => undefined} align="left" />
              </div>

              <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-slate-600 sm:flex sm:flex-wrap">
                {[
                  "Near major airports",
                  "Verified hosts",
                  "Flexible stays",
                  "Transparent pricing",
                ].map((item) => (
                  <li key={item} className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-slate-700">
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              <p className="mt-6 text-sm text-slate-600">
                Hosting near an airport?{" "}
                <button
                  type="button"
                  onClick={() => router.push("/host/create-listing")}
                  className="font-semibold text-slate-900 transition hover:underline"
                >
                  Become a host
                </button>
              </p>
            </div>

            <div>
              <div className="relative min-h-[300px] md:min-h-[420px] lg:min-h-[560px]">
                <Image
                  src="/Hero-Image-2.png"
                  alt="Professional walking toward accommodation near airport transport links"
                  fill
                  sizes="(min-width: 1024px) 54vw, 100vw"
                  className="absolute inset-0 h-full w-full object-cover"
                  priority
                />

                <div className="absolute right-6 top-6 z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur lg:right-8 lg:top-8">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    10 min to Stansted
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">Quiet stay · Verified host</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        ref={dividerRef}
        className={`border-b border-t border-white/5 bg-[#0F172A] py-12 transition-all duration-[600ms] ease-out md:py-16 ${
          dividerVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mx-auto mb-6 h-px w-24 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <h2 className="relative text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Built for professionals, not tourists
            </h2>
            <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
              Reliable stays near airports, built around real crew schedules — not holiday bookings.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            {[
              { label: "Near major airports", Icon: DividerPinIcon },
              { label: "Verified hosts", Icon: DividerShieldIcon },
              { label: "Transparent pricing", Icon: DividerPriceIcon },
            ].map(({ label, Icon }) => (
              <div
                key={label}
                className="group flex min-h-[58px] items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.04]"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-amber-300/75 transition-colors duration-200 group-hover:bg-white/[0.08] group-hover:text-amber-200">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-slate-300 transition-colors duration-200 group-hover:text-white">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 lg:pb-20">
        <div className="mb-10 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              Stays near major airports
            </h2>
            <p className="mt-2 text-sm text-slate-600 sm:text-base">
              Reliable accommodation within easy reach of the terminal.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/search")}
            className="shrink-0 text-sm font-semibold text-slate-700 transition hover:text-slate-900"
          >
            View all stays →
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {AIRPORT_MARKETPLACE_STAYS.map((stay) => (
            <button
              key={stay.id}
              type="button"
              onClick={() => router.push(stay.href)}
              className="group mx-auto w-full max-w-[360px] appearance-none border-0 bg-transparent p-0 text-left"
            >
              <div className="relative h-[190px] overflow-hidden rounded-xl">
                <Image
                  src={stay.imageUrl}
                  alt={stay.title}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                  className="object-cover"
                />
                <span className="absolute left-3 top-3 rounded-full bg-slate-900/85 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur-[4px]">
                  {stay.minutesToAirport} min to {stay.airportCode}
                </span>
              </div>

              <div className="mt-3 space-y-1.5">
                <h3 className="text-base font-semibold leading-[1.3] text-slate-900">{stay.title}</h3>
                <p className="truncate text-sm leading-[1.4] text-slate-500">{stay.description}</p>

                <div className="mt-2 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-sm text-slate-700">
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-black" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M10 2.4l2.1 4.27 4.72.69-3.42 3.33.81 4.71L10 13.2l-4.22 2.2.81-4.71L3.17 7.36l4.72-.69L10 2.4Z"
                      />
                    </svg>
                    <span>
                      {stay.rating.toFixed(1)} ({stay.reviews})
                    </span>
                  </span>
                  <span className="text-sm font-medium text-slate-600">
                    {stay.trustBadge}
                  </span>
                </div>

                <p className="pt-0.5 text-right text-[15px] font-semibold text-slate-900">£{stay.pricePerNight} / night</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-8 pt-6 lg:pb-10 lg:pt-8">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Stay types designed around real schedules
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {[
            {
              title: "Day-use stays",
              body: "For quick rest windows, standby time, and between-duty recovery.",
              ctaLabel: "Explore day-use stays",
              href: "/search?mode=day_use",
              icon: (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <circle cx="12" cy="12" r="8" />
                  <path d="M12 8v4l3 2" />
                </svg>
              ),
            },
            {
              title: "Extended stays",
              body: "For repeat rotations, training blocks, and longer assignments.",
              ctaLabel: "Explore extended stays",
              href: "/search?mode=extended",
              icon: (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M4 20h16" />
                  <path d="M6 20V8h12v12" />
                  <path d="M9 12h.01M12 12h.01M15 12h.01" />
                </svg>
              ),
            },
          ].map((item) => (
            <article key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                {item.icon}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => router.push(item.href)}
                  className="text-sm font-semibold text-slate-900 transition hover:text-slate-700"
                >
                  {item.ctaLabel} →
                </button>
                <span className="text-xs text-slate-500">Available on eligible listings</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-8 pt-1 lg:pb-10">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Built around real schedules
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Search by airport",
              body: "Start from the airport you operate from and filter by commute time.",
              icon: (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M12 22s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z" />
                  <circle cx="12" cy="10" r="2.8" />
                </svg>
              ),
            },
            {
              title: "Choose the stay type",
              body: "Pick overnight, day-use, or longer formats based on duty windows.",
              icon: (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <rect x="3" y="5" width="18" height="15" rx="2.5" />
                  <path d="M3 10h18" />
                </svg>
              ),
            },
            {
              title: "Book with clear rules",
              body: "Transparent pricing and enforced booking modes reduce surprises.",
              icon: (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M20 7 9 18l-5-5" />
                </svg>
              ),
            },
          ].map((item) => (
            <article key={item.title} className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm">
                {item.icon}
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 pt-1 lg:pb-14">
        <div className="rounded-[28px] border border-slate-800 bg-slate-900 px-7 py-10 text-white shadow-sm md:flex md:items-center md:justify-between md:px-10 md:py-12">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Host with Avyro</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight">
              Host near an airport? List with Avyro
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Attract professional guests, set clear booking rules, and offer stays that fit real schedules.
            </p>
          </div>
          <button
            onClick={() => router.push("/host/create-listing")}
            className="mt-6 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 md:mt-0"
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

      {/* Remove old results grid; handled in curated homepage sections above */}
    </main>
  );
}
