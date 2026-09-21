import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";

import SearchBar from "@/components/SearchBar";
import { supabase } from "@/lib/supabaseClient";
import { SUPPORT_EMAIL } from "@/lib/support";
import {
  getHostingHomeHref,
  getTravellingHomeHref,
  hasGuestAccess,
  hasHostAccess,
  persistActiveRole,
  readStoredActiveRole,
  resolveActiveRole,
  resolvePrimaryRole,
  type ActiveRole,
} from "@/lib/roleMode";

type Profile = {
  full_name: string | null;
  avatar_url: string | null;
  role_host: boolean;
  role_guest: boolean;
  primary_role: string | null;
  active_role: string | null;
};

type AppHeaderProps = {
  notificationCount?: number;
  onSignOut?: () => Promise<void> | void;
  initialProfile?: Profile | null;
};

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const normalizePath = (value: string) => {
  const [withoutHash] = value.split("#");
  const [withoutQuery] = withoutHash.split("?");
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed || "/";
};

const TRAVELLING_NAV = [
  { label: "Search", href: "/search" },
  { label: "Trips", href: "/guest/dashboard" },
  { label: "Payments", href: "/guest/payments" },
  { label: "Messages", href: "/guest/messages" },
];

// What a visitor who is not logged in sees: no account areas (Trips / Payments / Messages), just the
// ways in. "Become a host" matches the hero, banner and footer on the homepage.
const LOGGED_OUT_NAV = [
  { label: "Search stays", href: "/search" },
  { label: "Become a host", href: "/host/create-listing" },
  { label: "How it works", href: "/#how-it-works" },
];

const YELLOW_CTA_CLASS =
  "group relative h-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#FEDD02] px-4 text-sm font-semibold text-black shadow-md transition-all duration-200 ease-out hover:-translate-y-px hover:bg-[#E6C902] hover:shadow-[0_8px_16px_rgba(201,176,2,0.32)] active:translate-y-0 active:scale-[0.99] active:bg-[#C9B002] focus:outline-none focus:ring-4 focus:ring-[#FEDD02]/40";

const HOSTING_NAV = [
  { label: "Your places", href: "/host/listings" },
  { label: "Calendar", href: "/host/calendar" },
  { label: "Occupancy", href: "/host/guests" },
  { label: "Earnings", href: "/host/payouts" },
  { label: "Hosting insights", href: "/host/dashboard" },
];

async function resolveHostingDestination() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return "/login";

  const { count } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return getHostingHomeHref((count ?? 0) > 0);
}

export function AppHeader({ notificationCount, onSignOut, initialProfile = null }: AppHeaderProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [loadingProfile, setLoadingProfile] = useState(!initialProfile);
  const [signingOut, setSigningOut] = useState(false);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [switchingRole, setSwitchingRole] = useState<ActiveRole | null>(null);

  // a new avatar URL gets a fresh chance to load
  useEffect(() => {
    setAvatarFailed(false);
  }, [profile?.avatar_url]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAuthTimedOut(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    const handleAuthFailure = () => {
      if (!active) return;
      // A blocked or interrupted auth request should leave the header signed out,
      // not surface as an unhandled client-side error.
      setProfile(null);
      setLoadingProfile(false);
    };

    const loadProfileForUser = async (user: { id: string; email?: string | null; user_metadata?: any } | null | undefined) => {
      if (!user) {
        if (!active) return;
        setProfile(null);
        setLoadingProfile(false);
        return;
      }

      const fallbackAvatar = user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, role_host, role_guest, primary_role, active_role")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;

      setProfile(
        data
          ? {
              full_name: data.full_name ?? user.email ?? null,
              avatar_url: data.avatar_url ?? fallbackAvatar,
              role_host: Boolean(data.role_host),
              role_guest: Boolean(data.role_guest),
              primary_role: data.primary_role ?? null,
              active_role: data.active_role ?? null,
            }
          : {
              full_name: user.email ?? null,
              avatar_url: fallbackAvatar,
              role_host: false,
              role_guest: false,
              primary_role: null,
              active_role: null,
            }
      );
      setLoadingProfile(false);
    };

    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => loadProfileForUser(session?.user ?? null))
      .catch(handleAuthFailure);

    // AppHeader is a persistent shared layout component -- it is not
    // remounted by a client-side router.push() between pages. Without this
    // subscription, the header's profile state only ever reflected whatever
    // was true at first mount, so a sign-out (or signing in as a different
    // user right after) was never reflected until a full page reload.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfileForUser(session?.user ?? null).catch(handleAuthFailure);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [initialProfile]);

  useEffect(() => {
    if (!menuOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const primaryRole = resolvePrimaryRole(profile);
  const activeRole = resolveActiveRole(profile, readStoredActiveRole());
  const canHost = hasHostAccess(profile);
  const canGuest = hasGuestAccess(profile);
  const contextLabel = activeRole === "host" ? "Hosting" : "Travelling";
  // Hide the auth-dependent parts briefly while the session loads (so a logged-in user never sees the
  // visitor menu flash by), but never for long: after 1.2s a slow or stuck lookup falls back to the
  // visitor header instead of leaving it empty. It updates as soon as a profile does arrive.
  const authKnown = Boolean(profile) || !loadingProfile || authTimedOut;
  const isLoggedOut = !profile && authKnown;
  const navItems = isLoggedOut ? LOGGED_OUT_NAV : activeRole === "host" ? HOSTING_NAV : TRAVELLING_NAV;
  const isResultsPage = router.pathname === "/search";
  const headerSearchGuests = useMemo(() => {
    const rawGuests = router.query.guests;
    if (typeof rawGuests === "string" && rawGuests.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawGuests);
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
      adults: Number(router.query.adults || 0),
      children: Number(router.query.children || 0),
      infants: Number(router.query.infants || 0),
      pets: Number(router.query.pets || 0),
    };
  }, [router.query]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (onSignOut) {
        await onSignOut();
      } else {
        await supabase.auth.signOut();
        // Immediate, synchronous-feeling clear -- the onAuthStateChange
        // subscription above will also fire and confirm this, but the
        // menu/pill should never render stale logged-in state even for the
        // brief window before that event is delivered.
        setProfile(null);
        router.push("/login");
      }
    } catch (err) {
      console.error("Unable to sign out", err);
    } finally {
      setSigningOut(false);
    }
  };

  const isSameRoute = (href: string) => normalizePath(router.asPath) === normalizePath(href);

  const go = (href: string) => {
    // hash links (e.g. /#how-it-works) must always navigate, even when already on that page
    if (href.includes("#") || !isSameRoute(href)) {
      router.push(href).catch(() => null);
    }
    setMenuOpen(false);
  };

  const switchRole = async (nextRole: ActiveRole) => {
    if (!profile || switchingRole) return;
    setSwitchingRole(nextRole);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        router.push("/login");
        return;
      }

      const { error } = await supabase.from("profiles").update({ active_role: nextRole }).eq("id", userId);
      if (error) throw error;

      persistActiveRole(nextRole);
      setProfile((current) => (current ? { ...current, active_role: nextRole } : current));

      const destination =
        nextRole === "host" ? await resolveHostingDestination() : getTravellingHomeHref();
      setMenuOpen(false);
      if (!isSameRoute(destination)) {
        router.push(destination).catch(() => null);
      }
    } catch (error) {
      console.error("Unable to switch role", error);
    } finally {
      setSwitchingRole(null);
    }
  };

  const displayName =
    profile?.full_name?.trim() ||
    (router.isReady ? String(router.query?.email || "") : "") ||
    "Member";

  const initials =
    displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "F";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/70 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6 lg:px-8">
        <button
          type="button"
          onClick={() => {
            const homeHref = activeRole === "host" ? "/host/dashboard" : "/";
            if (!isSameRoute(homeHref)) {
              router.push(homeHref).catch(() => null);
            }
          }}
          className="shrink-0 bg-transparent p-0 hover:bg-transparent focus-visible:outline-none"
          aria-label="Flexivo home"
        >
          <Image
            src="/Flexivo%20v4.svg"
            alt="Flexivo - Accommodation for Professionals"
            width={141}
            height={37}
            priority
            style={{ width: "141px", height: "auto" }}
            className="cursor-pointer"
          />
        </button>

        {isResultsPage ? (
          <div className="hidden flex-1 justify-center lg:flex">
            <div className="w-full max-w-[520px]">
              <SearchBar
                align="center"
                variant="nav"
                onSearch={() => undefined}
                initialQuery={{
                  location:
                    typeof router.query.location === "string" ? router.query.location : undefined,
                  checkIn:
                    typeof router.query.checkIn === "string" ? router.query.checkIn : undefined,
                  checkOut:
                    typeof router.query.checkOut === "string" ? router.query.checkOut : undefined,
                  checkInTime:
                    typeof router.query.checkInTime === "string"
                      ? router.query.checkInTime
                      : undefined,
                  checkOutTime:
                    typeof router.query.checkOutTime === "string"
                      ? router.query.checkOutTime
                      : undefined,
                  bookingUnit:
                    router.query.bookingUnit === "hourly"
                      ? "hourly"
                      : router.query.bookingUnit === "nightly"
                      ? "nightly"
                      : undefined,
                  guests: headerSearchGuests,
                }}
              />
            </div>
          </div>
        ) : null}

        <div
          className={cx(
            "hidden items-center gap-6 md:flex",
            isResultsPage && "lg:hidden",
            !authKnown && "invisible"
          )}
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "text-sm font-medium text-slate-600 transition-colors duration-200 hover:text-slate-900",
                !item.href.includes("#") &&
                  normalizePath(router.asPath).startsWith(normalizePath(item.href)) &&
                  "text-slate-900"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {!profile ? (
            <Link
              href="/login"
              className={cx(
                "inline-flex text-sm font-medium text-slate-600 transition-colors duration-200 hover:text-slate-900",
                !authKnown && "invisible"
              )}
            >
              Log in
            </Link>
          ) : null}

          {profile && (canHost || canGuest) ? (
            <button
              type="button"
              onClick={() => {
                if (activeRole === "host" && canGuest) {
                  void switchRole("guest");
                } else if (activeRole !== "host" && canHost) {
                  void switchRole("host");
                }
              }}
              disabled={Boolean(switchingRole)}
              className="hidden rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
            >
              {switchingRole
                ? "Switching…"
                : activeRole === "host"
                ? "Switch to Travelling"
                : "Switch to Hosting"}
            </button>
          ) : !profile ? (
            <Link
              href="/login"
              className={cx("hidden sm:inline-flex", YELLOW_CTA_CLASS, !authKnown && "invisible")}
            >
              <span className="relative z-10">Sign up</span>
            </Link>
          ) : (
            <Link href="/search" className={cx("hidden sm:inline-flex", YELLOW_CTA_CLASS)}>
              <span className="relative z-10">Search stays</span>
            </Link>
          )}

          <div
            ref={dropdownRef}
            className={cx("relative", authKnown ? isLoggedOut && "md:hidden" : "md:invisible")}
          >
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Open menu"
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-300 hover:shadow-sm"
            >
              {isLoggedOut ? (
                <span aria-hidden className="flex h-7 w-7 items-center justify-center text-slate-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
                    <path d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                </span>
              ) : (
              <>
              <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-slate-100">
                {profile?.avatar_url && !avatarFailed ? (
                  <img
                    src={profile.avatar_url}
                    alt="Profile"
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    className="h-full w-full object-cover"
                  />
                ) : loadingProfile ? (
                  <span className="h-full w-full animate-pulse bg-slate-200" />
                ) : (
                  <span className="text-xs font-semibold text-slate-700">{initials}</span>
                )}
                {!!notificationCount && notificationCount > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                    {notificationCount}
                  </span>
                ) : null}
              </span>
              <span className="hidden text-sm font-medium text-slate-700 sm:inline">
                {profile ? displayName.split(" ")[0] : "Menu"}
              </span>
              <span className="text-xs text-slate-400">▾</span>
              </>
              )}
            </button>

            {menuOpen ? (
              <div
                className="absolute right-0 top-full mt-3 w-[310px] overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.14)]"
                role="menu"
              >
                {profile ? (
                  <>
                    <div className="border-b border-slate-200 px-5 py-4">
                      <p className="text-[22px] font-semibold leading-none text-slate-900">{displayName}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {primaryRole === "both" ? `${contextLabel} mode` : primaryRole === "host" ? "Hosting" : "Travelling"}
                      </p>
                    </div>

                    {primaryRole === "both" ? (
                      <div className="border-b border-slate-200 px-5 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                          Mode
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => void switchRole("guest")}
                            disabled={Boolean(switchingRole)}
                            className={cx(
                              "rounded-2xl border px-3 py-3 text-left text-sm transition",
                              activeRole === "guest"
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                            )}
                          >
                            Switch to Travelling
                          </button>
                          <button
                            type="button"
                            onClick={() => void switchRole("host")}
                            disabled={Boolean(switchingRole)}
                            className={cx(
                              "rounded-2xl border px-3 py-3 text-left text-sm transition",
                              activeRole === "host"
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                            )}
                          >
                            Switch to Hosting
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <nav className="py-1 text-[15px] text-slate-800">
                      {activeRole === "host" ? (
                        <>
                          <ButtonMenuItem label="Your places" onClick={() => go("/host/listings")} strong />
                          <ButtonMenuItem label="Calendar" onClick={() => go("/host/calendar")} />
                          <ButtonMenuItem label="Occupancy" onClick={() => go("/host/guests")} />
                          <ButtonMenuItem label="Earnings" onClick={() => go("/host/payouts")} />
                          <ButtonMenuItem label="Hosting insights" onClick={() => go("/host/dashboard")} />
                          <ButtonMenuItem label="Profile" onClick={() => go("/host/profile")} />
                        </>
                      ) : (
                        <>
                          <ButtonMenuItem label="Search" onClick={() => go("/search")} strong />
                          <ButtonMenuItem label="Trips" onClick={() => go("/guest/dashboard")} />
                          <ButtonMenuItem label="Payments" onClick={() => go("/guest/payments")} />
                          <ButtonMenuItem label="Messages" onClick={() => go("/guest/messages")} />
                          <ButtonMenuItem label="Profile" onClick={() => go("/guest/profile")} />
                        </>
                      )}
                      {!canHost ? (
                        <ButtonMenuItem label="Host a place" onClick={() => go("/role-setup")} />
                      ) : null}
                      <hr className="my-1 border-slate-200" />
                      <ButtonMenuItem
                        label={signingOut ? "Signing out..." : "Log out"}
                        onClick={() => {
                          void handleSignOut();
                          setMenuOpen(false);
                        }}
                        disabled={signingOut}
                        danger
                      />
                    </nav>
                  </>
                ) : (
                  <div className="py-1 text-[15px] text-slate-800">
                    <div className="px-5 py-3 text-sm font-medium text-slate-700">Welcome to Flexivo</div>
                    <div className="pb-1">
                      <ButtonMenuItem label="Log in or sign up" onClick={() => go("/login")} strong />
                      <hr className="my-1 border-slate-200" />
                      <ButtonMenuItem label="Search stays" onClick={() => go("/search")} />
                      <ButtonMenuItem label="Become a host" onClick={() => go("/host/create-listing")} />
                      <ButtonMenuItem label="How it works" onClick={() => go("/#how-it-works")} />
                      <hr className="my-1 border-slate-200" />
                      <ButtonMenuItem
                        label="Contact support"
                        onClick={() => {
                          window.location.href = `mailto:${SUPPORT_EMAIL}`;
                          setMenuOpen(false);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

type ButtonMenuItemProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  strong?: boolean;
};

function ButtonMenuItem({ label, onClick, disabled, danger, strong }: ButtonMenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "w-full px-5 py-3 text-left transition-colors duration-150",
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-800 hover:bg-slate-50",
        strong && !danger && "font-semibold text-slate-900",
        disabled && "cursor-not-allowed opacity-60"
      )}
      role="menuitem"
    >
      <span>{label}</span>
    </button>
  );
}
