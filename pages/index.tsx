// pages/index.tsx
// Home — refined hero, search-first experience, category rows

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
    trustBadge: "Hosted on Flexivo",
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

const DividerCalendarIcon = ({ className }: DividerIconProps) => (
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
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <path d="M4 10h16" />
  </svg>
);

const DividerCheckIcon = ({ className }: DividerIconProps) => (
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
    <path d="M20 7 9 18l-5-5" />
  </svg>
);

export default function Home() {
  const router = useRouter();

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
                  "Hosted on Flexivo",
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
                  <p className="mt-1 text-sm font-medium text-slate-900">Quiet stay · Hosted on Flexivo</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/5 bg-[#0F172A] py-10 md:py-12">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Built around real schedules
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Search by airport",
                body: "Start from the airport you operate from and filter by commute time.",
                icon: DividerPinIcon,
              },
              {
                title: "Choose the stay type",
                body: "Pick overnight, day-use, or longer formats based on duty windows.",
                icon: DividerCalendarIcon,
              },
              {
                title: "Book with clear rules",
                body: "Transparent pricing and enforced booking modes reduce surprises.",
                icon: DividerCheckIcon,
              },
            ].map((item) => (
              <article key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
                <span className="inline-flex h-7 w-7 items-center justify-center text-slate-300">
                  <item.icon className="h-4 w-4" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-300 md:leading-6">{item.body}</p>
              </article>
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

      <section className="bg-[#fafafa]">
        <div className="mx-auto max-w-6xl px-4 py-10 lg:py-12">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              Designed around real crew schedules
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
              Whether it&apos;s a quick turnaround or a repeat rotation, find stays that fit how you
              actually work.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[
              {
                title: "Day-use stays",
                body: "For quick rest windows, standby time, and between-duty recovery.",
                ctaLabel: "Explore day-use stays",
                href: "/search?mode=day_use",
              },
              {
                title: "Extended stays",
                body: "For repeat rotations, training blocks, and longer assignments.",
                ctaLabel: "Explore extended stays",
                href: "/search?mode=extended",
              },
            ].map((item) => (
              <article
                key={item.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
                <button
                  type="button"
                  onClick={() => router.push(item.href)}
                  className="mt-5 text-sm font-semibold text-slate-900 transition hover:text-slate-700"
                >
                  {item.ctaLabel} →
                </button>
              </article>
            ))}
          </div>

          <div className="mt-5 rounded-[28px] border border-slate-800 bg-slate-900 px-7 py-11 text-white shadow-sm md:flex md:items-center md:justify-between md:px-10 md:py-12">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">For hosts</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-[34px]">
                List your property near an airport
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Attract professional guests, set clear booking rules, and offer stay types that
                match real crew schedules.
              </p>
            </div>
            <button
              onClick={() => router.push("/host/create-listing")}
              className="mt-6 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 md:mt-0"
            >
              Become a host
            </button>
          </div>
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
                Veloro platform
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
                  links: ["About Veloro", "Careers", "Press", "Security", "Privacy"],
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
            <span>© 2026 Veloro. All rights reserved.</span>
            <span>United Kingdom · Europe</span>
          </div>
        </div>
      </footer>

      {/* Remove old results grid; handled in curated homepage sections above */}
    </main>
  );
}
