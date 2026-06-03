export type PrimaryRole = "guest" | "host" | "both";
export type ActiveRole = "guest" | "host";

export type RoleProfileShape = {
  role_host?: boolean | null;
  role_guest?: boolean | null;
  primary_role?: string | null;
  active_role?: string | null;
};

export const ACTIVE_ROLE_STORAGE_KEY = "flexivo.active_role";

const isPrimaryRole = (value: unknown): value is PrimaryRole =>
  value === "guest" || value === "host" || value === "both";

const isActiveRole = (value: unknown): value is ActiveRole =>
  value === "guest" || value === "host";

export const hasHostAccess = (profile: RoleProfileShape | null | undefined) =>
  Boolean(profile?.role_host) || profile?.primary_role === "host" || profile?.primary_role === "both";

export const hasGuestAccess = (profile: RoleProfileShape | null | undefined) =>
  Boolean(profile?.role_guest) || profile?.primary_role === "guest" || profile?.primary_role === "both";

export function resolvePrimaryRole(profile: RoleProfileShape | null | undefined): PrimaryRole | null {
  const primaryRole = profile?.primary_role;
  if (isPrimaryRole(primaryRole)) return primaryRole;

  const host = Boolean(profile?.role_host);
  const guest = Boolean(profile?.role_guest);
  if (host && guest) return "both";
  if (host) return "host";
  if (guest) return "guest";
  return null;
}

export function resolveActiveRole(
  profile: RoleProfileShape | null | undefined,
  storedRole?: string | null
): ActiveRole | null {
  const requested = storedRole ?? profile?.active_role ?? null;
  const host = hasHostAccess(profile);
  const guest = hasGuestAccess(profile);

  if (requested === "host" && host) return "host";
  if (requested === "guest" && guest) return "guest";
  if (host && !guest) return "host";
  if (guest && !host) return "guest";
  if (host && guest) return "guest";
  return null;
}

export function buildRoleUpdates(primaryRole: PrimaryRole): {
  primary_role: PrimaryRole;
  active_role: ActiveRole;
  role_host: boolean;
  role_guest: boolean;
} {
  if (primaryRole === "host") {
    return {
      primary_role: "host",
      active_role: "host",
      role_host: true,
      role_guest: false,
    };
  }

  if (primaryRole === "both") {
    return {
      primary_role: "both",
      active_role: "guest",
      role_host: true,
      role_guest: true,
    };
  }

  return {
    primary_role: "guest",
    active_role: "guest",
    role_host: false,
    role_guest: true,
  };
}

export function persistActiveRole(activeRole: ActiveRole) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, activeRole);
}

export function readStoredActiveRole() {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY);
  return isActiveRole(value) ? value : null;
}

export function getTravellingHomeHref() {
  return "/search";
}

export function getHostingHomeHref(hasListings: boolean) {
  return hasListings ? "/host/dashboard" : "/host/create-listing";
}
