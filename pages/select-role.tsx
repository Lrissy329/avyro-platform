import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import { supabase } from "@/lib/supabaseClient";
import {
  getHostingHomeHref,
  getTravellingHomeHref,
  hasGuestAccess,
  hasHostAccess,
  persistActiveRole,
  resolvePrimaryRole,
  type ActiveRole,
} from "@/lib/roleMode";

async function getHostDestination(userId: string) {
  const { count } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return getHostingHomeHref((count ?? 0) > 0);
}

export default function SelectRolePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ActiveRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        if (active) router.replace("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role_host, role_guest, primary_role, active_role")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;

      const primaryRole = resolvePrimaryRole(profile);
      const canHost = hasHostAccess(profile);
      const canGuest = hasGuestAccess(profile);

      if (!primaryRole) {
        router.replace("/role-setup");
        return;
      }

      if (!canHost && canGuest) {
        router.replace(getTravellingHomeHref());
        return;
      }

      if (canHost && !canGuest) {
        router.replace(await getHostDestination(user.id));
        return;
      }

      setUserId(user.id);
      setLoading(false);
    })().catch((err: any) => {
      if (!active) return;
      setError(err?.message ?? "Unable to load your role options.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [router]);

  const activateRole = async (nextRole: ActiveRole) => {
    if (!userId) return;
    setSaving(nextRole);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ active_role: nextRole })
        .eq("id", userId);

      if (updateError) throw updateError;

      persistActiveRole(nextRole);
      const destination =
        nextRole === "host" ? await getHostDestination(userId) : getTravellingHomeHref();
      router.replace(destination);
    } catch (err: any) {
      setError(err?.message ?? "Unable to switch modes right now.");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-6">
          <p className="text-sm text-slate-500">Loading your Flexivo mode…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-16">
        <div className="w-full rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Choose your context
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">
            What would you like to do right now?
          </h1>
          <p className="mt-3 max-w-2xl text-base text-slate-600">
            You can switch between travelling and hosting whenever you need. Your account and
            bookings stay in one place.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => activateRole("guest")}
              disabled={Boolean(saving)}
              className="rounded-3xl border border-slate-200 bg-white px-6 py-6 text-left transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="text-lg font-semibold text-slate-900">Switch to Travelling</p>
              <p className="mt-2 text-sm text-slate-600">
                Browse airport stays, manage trips, and keep payments in one place.
              </p>
            </button>

            <button
              type="button"
              onClick={() => activateRole("host")}
              disabled={Boolean(saving)}
              className="rounded-3xl border border-slate-200 bg-white px-6 py-6 text-left transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="text-lg font-semibold text-slate-900">Switch to Hosting</p>
              <p className="mt-2 text-sm text-slate-600">
                Manage places, occupancy, and earnings without leaving your main account.
              </p>
            </button>
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {saving ? <p className="mt-6 text-sm text-slate-500">Updating your mode…</p> : null}
        </div>
      </div>
    </main>
  );
}

(SelectRolePage as any).hideGlobalHeader = true;
