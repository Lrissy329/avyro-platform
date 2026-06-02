import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  full_name: string | null;
  avatar_url: string | null;
  role_host: boolean;
  role_guest: boolean;
};

type AppHeaderProps = {
  notificationCount?: number;
  onSignOut?: () => Promise<void> | void;
  initialProfile?: Profile | null;
};

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const resolveDashboardHref = (profile: Profile | null) => {
  if (!profile) return "/login";
  if (profile.role_host) return "/host/dashboard";
  if (profile.role_guest) return "/guest/dashboard";
  return "/guest/dashboard";
};

export function AppHeader({ notificationCount, onSignOut, initialProfile = null }: AppHeaderProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [loadingProfile, setLoadingProfile] = useState(!initialProfile);
  const [signingOut, setSigningOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        setProfile(null);
        setLoadingProfile(false);
        return;
      }

      if (initialProfile) {
        setProfile(initialProfile);
        setLoadingProfile(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, role_host, role_guest")
        .eq("id", user.id)
        .single();

      const fallbackAvatar =
        user.user_metadata?.avatar_url ??
        user.user_metadata?.picture ??
        null;

      setProfile(
        data
          ? {
              full_name: data.full_name ?? user.email ?? null,
              avatar_url: data.avatar_url ?? fallbackAvatar,
              role_host: Boolean(data.role_host),
              role_guest: Boolean(data.role_guest),
            }
          : {
              full_name: user.email ?? null,
              avatar_url: fallbackAvatar,
              role_host: false,
              role_guest: false,
            }
      );
      setLoadingProfile(false);
    })();
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

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (onSignOut) {
        await onSignOut();
      } else {
        await supabase.auth.signOut();
        router.push("/login");
      }
    } catch (err) {
      console.error("Unable to sign out", err);
    } finally {
      setSigningOut(false);
    }
  };

  const normalizePath = (value: string) => {
    const [withoutHash] = value.split("#");
    const [withoutQuery] = withoutHash.split("?");
    const trimmed = withoutQuery.replace(/\/+$/, "");
    return trimmed || "/";
  };

  const isSameRoute = (href: string) => normalizePath(router.asPath) === normalizePath(href);

  const go = (href: string) => {
    if (!isSameRoute(href)) {
      router.push(href).catch(() => null);
    }
    setMenuOpen(false);
  };

  const displayName =
    profile?.full_name?.trim() ||
    (router.isReady ? String(router.query?.email || "") : "") ||
    "Guest";

  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "G";

  const dashboardHref = resolveDashboardHref(profile);
  const hostNavHref = profile?.role_host ? "/host/dashboard" : "/host/create-listing";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6 lg:px-8">
        <button
          type="button"
          onClick={() => {
            if (!isSameRoute("/")) {
              router.push("/").catch(() => null);
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

        <div className="flex items-center gap-2 sm:gap-3">
          <nav className="hidden items-center gap-6 md:flex">
            <Link
              href="/search"
              className={cx(
                "text-sm font-medium text-slate-600 transition-colors duration-200 hover:text-slate-900",
                router.pathname === "/search" && "text-slate-900"
              )}
            >
              Stays
            </Link>
            <Link
              href={hostNavHref}
              className={cx(
                "text-sm font-medium text-slate-600 transition-colors duration-200 hover:text-slate-900",
                router.pathname.startsWith("/host") && "text-slate-900"
              )}
            >
              Host
            </Link>
          </nav>

          {!profile ? (
            <Link
              href="/login"
              className="hidden text-sm font-medium text-slate-600 transition-colors duration-200 hover:text-slate-900 sm:inline-flex"
            >
              Log in
            </Link>
          ) : null}

          <Link
            href="/search"
            className="group relative hidden h-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#FEDD02] px-4 text-sm font-semibold text-black shadow-md transition-all duration-200 ease-out hover:-translate-y-px hover:bg-[#E6C902] hover:shadow-[0_8px_16px_rgba(201,176,2,0.32)] active:translate-y-0 active:scale-[0.99] active:bg-[#C9B002] focus:outline-none focus:ring-4 focus:ring-[#FEDD02]/40 sm:inline-flex"
          >
            <span className="relative z-10">Search stays</span>
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-0 transition-all duration-200 ease-out group-hover:opacity-100"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </Link>

          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Open menu"
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-300 hover:shadow-sm"
            >
              <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-slate-100">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Profile"
                    className="h-full w-full object-cover"
                  />
                ) : loadingProfile ? (
                  <span className="h-full w-full animate-pulse bg-slate-200" />
                ) : (
                  <span className="text-xs font-semibold text-slate-700">{initials}</span>
                )}
                {!!notificationCount && notificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                    {notificationCount}
                    </span>
                )}
              </span>
              <span className="hidden text-sm font-medium text-slate-700 sm:inline">
                {profile ? displayName.split(" ")[0] : "Menu"}
              </span>
              <span className="text-xs text-slate-400">▾</span>
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-3 w-[290px] overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.14)]"
                role="menu"
              >
                {profile ? (
                  <>
                    <div className="border-b border-slate-200 px-5 py-4">
                      <p className="text-[22px] font-semibold leading-none text-slate-900">{displayName}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {profile.role_host ? "Host" : profile.role_guest ? "Guest" : "Member"}
                      </p>
                    </div>
                    <nav className="py-1 text-[15px] text-slate-800">
                      <ButtonMenuItem label="Dashboard" onClick={() => go(dashboardHref)} strong />
                      <ButtonMenuItem label="Explore stays" onClick={() => go("/search")} />
                      {profile.role_host ? (
                        <ButtonMenuItem label="Host messages" onClick={() => go("/host/messages")} />
                      ) : (
                        <ButtonMenuItem label="Trips" onClick={() => go("/guest/dashboard")} />
                      )}
                      <ButtonMenuItem label="Profile" onClick={() => go("/guest/profile")} />
                      {!profile.role_host ? (
                        <ButtonMenuItem label="Become a host" onClick={() => go("/host/create-listing")} />
                      ) : null}
                      <hr className="my-1 border-slate-200" />
                      <ButtonMenuItem
                        label={signingOut ? "Signing out..." : "Log out"}
                        onClick={() => {
                          handleSignOut();
                          setMenuOpen(false);
                        }}
                        disabled={signingOut}
                        danger
                      />
                    </nav>
                  </>
                ) : (
                  <div className="py-1 text-[15px] text-slate-800">
                    <div className="px-5 py-3 text-sm font-medium text-slate-700">Welcome to Veloro</div>
                    <div className="pb-1">
                      <ButtonMenuItem label="Log in or sign up" onClick={() => go("/login")} strong />
                      <hr className="my-1 border-slate-200" />
                      <ButtonMenuItem label="Search stays" onClick={() => go("/search")} />
                      <ButtonMenuItem label="Become a host" onClick={() => go("/host/create-listing")} />
                    </div>
                  </div>
                )}
              </div>
            )}
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

function ButtonMenuItem({
  label,
  onClick,
  disabled,
  danger,
  strong,
}: ButtonMenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "w-full px-5 py-3 text-left transition-colors duration-150",
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-slate-800 hover:bg-slate-50",
        strong && !danger && "font-semibold text-slate-900",
        disabled && "cursor-not-allowed opacity-60"
      )}
      role="menuitem"
    >
      <span>{label}</span>
    </button>
  );
}
