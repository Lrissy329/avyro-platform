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
  const hostCtaHref = profile?.role_host ? "/host/dashboard" : "/host/create-listing";
  const hostCtaLabel = profile?.role_host ? "Host dashboard" : "Become a host";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/90 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => {
            if (!isSameRoute("/")) {
              router.push("/").catch(() => null);
            }
          }}
          className="flex items-center bg-transparent p-0 hover:bg-transparent focus-visible:outline-none"
          aria-label="Avyro home"
        >
          <Image
            src="/avyro-logo.svg"
            alt="Avyro - Accommodation for Professionals"
            width={184}
            height={40}
            priority
            className="cursor-pointer"
          />
        </button>

        <div className="flex items-center gap-2 sm:gap-3">
          <nav className="hidden items-center gap-1 lg:flex">
            <Link
              href="/search"
              className={cx(
                "rounded-full px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100",
                router.pathname === "/search" && "bg-slate-100 text-slate-900"
              )}
            >
              Search stays
            </Link>
            <Link
              href={hostCtaHref}
              className="rounded-full px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              {hostCtaLabel}
            </Link>
          </nav>

          {profile ? (
            <Link
              href={dashboardHref}
              className="hidden rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 transition hover:border-slate-500 sm:inline-flex"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 transition hover:border-slate-500 sm:inline-flex"
              >
                Log in
              </Link>
              <Link
                href="/complete-profile"
                className="hidden rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 sm:inline-flex"
              >
                Sign up
              </Link>
            </>
          )}

          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Open menu"
              className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-2.5 py-1.5 transition hover:border-slate-500"
            >
              <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-slate-100">
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
              <span className="hidden text-sm font-medium text-slate-800 sm:inline">
                {profile ? displayName.split(" ")[0] : "Menu"}
              </span>
              <span className="text-xs text-slate-500">▾</span>
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-3 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
                role="menu"
              >
                {profile ? (
                  <>
                    <div className="border-b border-slate-100 px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{displayName}</p>
                      <p className="text-xs text-slate-500">
                        {profile.role_host ? "Host" : profile.role_guest ? "Guest" : "Member"}
                      </p>
                    </div>
                    <nav className="px-2 py-2 text-sm text-slate-700">
                      <ButtonMenuItem label="Dashboard" onClick={() => go(dashboardHref)} />
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
                      <hr className="my-2 border-slate-200" />
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
                  <div className="px-3 py-3">
                    <p className="mb-2 px-2 text-sm font-medium text-slate-700">Welcome to Avyro</p>
                    <div className="space-y-1 text-sm text-slate-700">
                      <ButtonMenuItem label="Log in" onClick={() => go("/login")} />
                      <ButtonMenuItem label="Sign up" onClick={() => go("/complete-profile")} primary />
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
  primary?: boolean;
};

function ButtonMenuItem({
  label,
  onClick,
  disabled,
  danger,
  primary,
}: ButtonMenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "w-full rounded-lg px-3 py-2 text-left transition",
        danger
          ? "text-red-600 hover:bg-red-50"
          : primary
          ? "bg-slate-900 text-white hover:bg-slate-700"
          : "hover:bg-slate-50",
        disabled && "cursor-not-allowed opacity-60"
      )}
      role="menuitem"
    >
      <span>{label}</span>
    </button>
  );
}
