import Image from "next/image";
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

export function AppHeader({ notificationCount, onSignOut, initialProfile = null }: AppHeaderProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(!initialProfile);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      setUserId(user?.id ?? null);

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
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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

  const initials =
    profile?.full_name?.[0] ??
    profile?.avatar_url ??
    (router.isReady ? router.query?.email?.[0] : undefined) ??
    "U";

  return (
    <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white">
      <div className="relative mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-8">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center bg-transparent p-0 hover:bg-transparent focus-visible:outline-none"
            aria-label="Avyro home"
          >
            <Image
              src="/avyro-logo.svg"
              alt="Avyro – Accommodation for Professionals"
              width={184}
              height={40}
              priority
              className="cursor-pointer"
            />
          </button>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() =>
              router.push(profile?.role_host ? "/host/dashboard" : "/host/create-listing")
            }
            className="hidden rounded-full px-3 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-100 md:block"
          >
            Become a host
          </button>

          <button
            type="button"
            aria-label="Change language"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-lg hover:bg-gray-100"
          >
            🌐
          </button>

          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="Toggle menu"
            className="relative flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 transition hover:shadow-md"
          >
            <span className="inline-flex h-4 w-4 flex-col justify-between">
              <span className="block h-0.5 w-full rounded-full bg-gray-700" />
              <span className="block h-0.5 w-full rounded-full bg-gray-700" />
              <span className="block h-0.5 w-full rounded-full bg-gray-700" />
            </span>
            <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gray-100">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : loadingProfile ? (
                <span className="h-full w-full animate-pulse bg-gray-200" />
              ) : (
                <span className="text-sm font-medium text-gray-700">
                  {initials?.toUpperCase()}
                </span>
              )}
              {!!notificationCount && notificationCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white">
                  {notificationCount}
                </span>
              )}
            </span>
          </button>
        </div>

        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute right-4 top-full mt-3 w-72 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl sm:right-0"
          >
            {profile ? (
              <>
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">
                    {profile.full_name ?? "Your account"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {profile.role_host ? "Host" : profile.role_guest ? "Guest" : "Member"}
                  </p>
                </div>
                <nav className="px-2 py-2 text-sm text-gray-700">
                  <ButtonMenuItem
                    label="Dashboard"
                    onClick={() => {
                      router.push(profile.role_host ? "/host/dashboard" : "/guest/dashboard");
                      setMenuOpen(false);
                    }}
                  />
                  <ButtonMenuItem
                    label="Messages"
                    onClick={() => {
                      router.push(
                        profile.role_host ? "/host/dashboard#messages" : "/guest/dashboard"
                      );
                      setMenuOpen(false);
                    }}
                  />
                  <ButtonMenuItem
                    label="Notifications"
                    badge={
                      notificationCount && notificationCount > 0
                        ? notificationCount
                        : undefined
                    }
                    onClick={() => {
                      router.push(profile.role_host ? "/host/dashboard" : "/guest/dashboard");
                      setMenuOpen(false);
                    }}
                  />
                  <ButtonMenuItem
                    label="Explore stays"
                    onClick={() => {
                      router.push("/search");
                      setMenuOpen(false);
                    }}
                  />
                  {profile.role_host && (
                    <ButtonMenuItem
                      label="Create listing"
                      onClick={() => {
                        router.push("/host/create-listing");
                        setMenuOpen(false);
                      }}
                    />
                  )}
                  <hr className="my-2 border-gray-200" />
                  <ButtonMenuItem
                    label={signingOut ? "Signing out…" : "Log out"}
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
              <div className="px-4 py-4 text-sm text-gray-700">
                <p className="mb-3 font-medium">Welcome to AeroNooc</p>
                <div className="flex flex-col gap-2">
                  <ButtonMenuItem
                    label="Log in"
                    onClick={() => {
                      router.push("/login");
                      setMenuOpen(false);
                    }}
                  />
                  <ButtonMenuItem
                    label="Sign up"
                    onClick={() => {
                      router.push("/complete-profile");
                      setMenuOpen(false);
                    }}
                    primary
                  />
                </div>
              </div>
            )}
          </div>
        )}
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
  badge?: string | number | null;
};

function ButtonMenuItem({
  label,
  onClick,
  disabled,
  danger,
  primary,
  badge,
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
          ? "bg-black text-white hover:bg-gray-900"
          : "hover:bg-gray-50",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {badge ? (
          <span className="inline-flex items-center justify-center rounded-full bg-gray-900 px-2 text-xs font-semibold text-white">
            {badge}
          </span>
        ) : null}
      </span>
    </button>
  );
}
