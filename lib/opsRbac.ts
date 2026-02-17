export type OpsRole = "sales_agent" | "support_agent" | "ops_manager" | "admin";

export const OPS_ROLES: OpsRole[] = [
  "sales_agent",
  "support_agent",
  "ops_manager",
  "admin",
];

export type OpsPermission =
  | "ops:dashboard:ops"
  | "ops:bookings:read"
  | "ops:bookings:write"
  | "ops:cases:read"
  | "ops:cases:write"
  | "ops:payouts:read"
  | "ops:verification:read"
  | "ops:verification:write"
  | "ops:users:read"
  | "ops:listings:read"
  | "ops:sales:read"
  | "ops:sales:write";

export type OpsNavItem = {
  href: string;
  label: string;
  permission: OpsPermission;
};

const ALL_PERMISSIONS: OpsPermission[] = [
  "ops:dashboard:ops",
  "ops:bookings:read",
  "ops:bookings:write",
  "ops:cases:read",
  "ops:cases:write",
  "ops:payouts:read",
  "ops:verification:read",
  "ops:verification:write",
  "ops:users:read",
  "ops:listings:read",
  "ops:sales:read",
  "ops:sales:write",
];

const ROLE_PERMISSIONS: Record<OpsRole, OpsPermission[]> = {
  sales_agent: ["ops:sales:read", "ops:sales:write"],
  support_agent: [
    "ops:bookings:read",
    "ops:bookings:write",
    "ops:cases:read",
    "ops:cases:write",
    "ops:verification:read",
  ],
  ops_manager: [
    "ops:dashboard:ops",
    "ops:bookings:read",
    "ops:bookings:write",
    "ops:cases:read",
    "ops:cases:write",
    "ops:payouts:read",
    "ops:verification:read",
    "ops:verification:write",
    "ops:listings:read",
    "ops:users:read",
    "ops:sales:read",
    "ops:sales:write",
  ],
  admin: ALL_PERMISSIONS,
};

export const NAV_ITEMS: OpsNavItem[] = [
  { href: "/ops/dashboard", label: "Dashboard", permission: "ops:dashboard:ops" },
  { href: "/ops/heatmap", label: "Heatmap", permission: "ops:dashboard:ops" },
  { href: "/ops/bookings", label: "Bookings", permission: "ops:bookings:read" },
  { href: "/ops/cases", label: "Cases", permission: "ops:cases:read" },
  { href: "/ops/payouts", label: "Payouts", permission: "ops:payouts:read" },
  { href: "/ops/verification", label: "Verification", permission: "ops:verification:read" },
  { href: "/ops/users", label: "Users", permission: "ops:users:read" },
  { href: "/ops/listings", label: "Listings", permission: "ops:listings:read" },
  { href: "/ops/sales/dashboard", label: "Sales dashboard", permission: "ops:sales:read" },
  { href: "/ops/sales/leads", label: "Sales", permission: "ops:sales:read" },
  { href: "/ops/sales/targets", label: "Sales targets", permission: "ops:sales:read" },
];

export function hasOpsPermission(role: OpsRole, permission: OpsPermission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getOpsNavItems(role?: OpsRole) {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => hasOpsPermission(role, item.permission));
}

export function getDefaultOpsRoute(role: OpsRole) {
  const item = getOpsNavItems(role)[0];
  return item?.href ?? "/ops/denied";
}

export function permissionForOpsPath(pathname: string): OpsPermission | null {
  if (pathname.startsWith("/ops/bookings")) return "ops:bookings:read";
  if (pathname.startsWith("/ops/cases")) return "ops:cases:read";
  if (pathname.startsWith("/ops/payouts")) return "ops:payouts:read";
  if (pathname.startsWith("/ops/verification")) return "ops:verification:read";
  if (pathname.startsWith("/ops/users")) return "ops:users:read";
  if (pathname.startsWith("/ops/listings")) return "ops:listings:read";
  if (pathname.startsWith("/ops/heatmap")) return "ops:dashboard:ops";
  if (pathname.startsWith("/ops/dashboard")) return "ops:dashboard:ops";
  if (pathname.startsWith("/ops/sales")) return "ops:sales:read";
  if (pathname === "/ops") return null;
  return null;
}
