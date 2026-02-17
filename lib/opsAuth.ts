import type { GetServerSidePropsContext, Redirect } from "next";
import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { OpsPermission, OpsRole } from "@/lib/opsRbac";
import { hasOpsPermission, permissionForOpsPath, OPS_ROLES } from "@/lib/opsRbac";

export type StaffUser = {
  user_id: string;
  role: OpsRole;
  active: boolean;
};

const staffRedirect = (destination: string): { redirect: Redirect } => ({
  redirect: { destination, permanent: false },
});

type RequireOpsOptions = {
  permission?: OpsPermission | null;
  path?: string;
};

export const logOpsForbiddenAttempt = async (args: {
  userId?: string | null;
  staffUserId?: string | null;
  role?: OpsRole | null;
  path?: string;
  permission?: OpsPermission | null;
  reason: string;
}) => {
  try {
    const admin = getSupabaseServerClient();
    await admin.from("audit_log").insert({
      actor_staff_user_id: args.staffUserId ?? null,
      action: "ops_access_denied",
      entity_type: "ops_route",
      entity_id: null,
      payload: {
        user_id: args.userId ?? null,
        role: args.role ?? null,
        path: args.path ?? null,
        permission: args.permission ?? null,
        reason: args.reason,
      },
    });
  } catch (err) {
    console.warn("[opsAuth] failed to log forbidden access", err);
  }
};

export async function requireOpsStaff(ctx: GetServerSidePropsContext, options: RequireOpsOptions = {}) {
  const supabase = createPagesServerClient(ctx);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return staffRedirect(`/login?redirect=${encodeURIComponent(ctx.resolvedUrl)}`);
  }

  const admin = getSupabaseServerClient();
  const { data: staff } = await admin
    .from("staff_users")
    .select("user_id, role, active")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!staff || !staff.active) {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff?.user_id ?? null,
      role: staff?.role ?? null,
      path: options.path ?? ctx.resolvedUrl,
      permission: options.permission ?? permissionForOpsPath(ctx.resolvedUrl),
      reason: "inactive_or_missing",
    });
    return staffRedirect("/ops/denied");
  }

  const requiredPermission = options.permission ?? permissionForOpsPath(ctx.resolvedUrl);
  const role = staff.role as OpsRole;

  if (!OPS_ROLES.includes(role)) {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff.user_id,
      role,
      path: options.path ?? ctx.resolvedUrl,
      permission: requiredPermission,
      reason: "unknown_role",
    });
    return staffRedirect("/ops/denied");
  }

  if (requiredPermission && !hasOpsPermission(role, requiredPermission)) {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff.user_id,
      role,
      path: options.path ?? ctx.resolvedUrl,
      permission: requiredPermission,
      reason: "insufficient_role",
    });
    return staffRedirect("/ops/denied");
  }

  return { session, staff: staff as StaffUser };
}

export async function requireOpsStaffApi(
  req: NextApiRequest,
  res: NextApiResponse,
  options: RequireOpsOptions = {}
) {
  const supabase = createPagesServerClient({ req, res });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const admin = getSupabaseServerClient();
  const { data: staff } = await admin
    .from("staff_users")
    .select("user_id, role, active")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!staff || !staff.active) {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff?.user_id ?? null,
      role: staff?.role ?? null,
      path: options.path ?? req.url,
      permission: options.permission ?? permissionForOpsPath(req.url ?? ""),
      reason: "inactive_or_missing",
    });
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  const requiredPermission = options.permission ?? permissionForOpsPath(req.url ?? "");
  const role = staff.role as OpsRole;

  if (!OPS_ROLES.includes(role)) {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff.user_id,
      role,
      path: options.path ?? req.url,
      permission: requiredPermission,
      reason: "unknown_role",
    });
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  if (requiredPermission && !hasOpsPermission(role, requiredPermission)) {
    await logOpsForbiddenAttempt({
      userId: session.user.id,
      staffUserId: staff.user_id,
      role,
      path: options.path ?? req.url,
      permission: requiredPermission,
      reason: "insufficient_role",
    });
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return { session, staff: staff as StaffUser, admin };
}
