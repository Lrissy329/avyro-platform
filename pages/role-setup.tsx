import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import { supabase } from "@/lib/supabaseClient";
import { buildRoleUpdates, getHostingHomeHref, getTravellingHomeHref, persistActiveRole, type PrimaryRole } from "@/lib/roleMode";

async function getHostDestination(userId: string) {
  const { count } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return getHostingHomeHref((count ?? 0) > 0);
}

const OPTIONS: Array<{
  value: PrimaryRole;
  title: string;
  description: string;
}> = [
  {
    value: "guest",
    title: "Find a stay",
    description: "Book accommodation near airports and transport hubs.",
  },
  {
    value: "host",
    title: "Host a place",
    description: "Earn from professionals needing short and medium-term stays.",
  },
  {
    value: "both",
    title: "Both",
    description: "Travel and host using one Flexivo account.",
  },
];

export default function RoleSetupPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<PrimaryRole>("guest");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        if (active) router.replace("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("primary_role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!active) return;

      if (profile?.primary_role === "guest" || profile?.primary_role === "host" || profile?.primary_role === "both") {
        if (profile.primary_role === "both") {
          router.replace("/select-role");
          return;
        }

        const nextHref =
          profile.primary_role === "host"
            ? await getHostDestination(session.user.id)
            : getTravellingHomeHref();
        router.replace(nextHref);
        return;
      }

      setLoading(false);
    })().catch((err: any) => {
      if (!active) return;
      setError(err?.message ?? "Unable to load onboarding.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [router]);

  const selectedCopy = useMemo(
    () => OPTIONS.find((option) => option.value === selectedRole) ?? OPTIONS[0],
    [selectedRole]
  );

  const handleContinue = async () => {
    setSaving(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/login");
        return;
      }

      const updates = buildRoleUpdates(selectedRole);
      const { error: updateError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: session.user.id,
            email: session.user.email ?? null,
            ...updates,
          },
          { onConflict: "id" }
        );

      if (updateError) {
        throw updateError;
      }

      persistActiveRole(updates.active_role);

      if (selectedRole === "both") {
        router.replace("/select-role");
        return;
      }

      const nextHref =
        selectedRole === "host"
          ? await getHostDestination(session.user.id)
          : getTravellingHomeHref();
      router.replace(nextHref);
    } catch (err: any) {
      setError(err?.message ?? "Unable to save your role preference.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-6">
          <p className="text-sm text-slate-500">Loading onboarding…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
        <div className="w-full rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Welcome to Flexivo
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-900">
              What brings you to Flexivo?
            </h1>
            <p className="mt-3 text-base text-slate-600">
              Choose the context you want Flexivo to prioritise first. You can switch later without
              creating a second account.
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
            <div className="space-y-4">
              {OPTIONS.map((option) => {
                const selected = option.value === selectedRole;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedRole(option.value)}
                    className={[
                      "w-full rounded-3xl border px-5 py-5 text-left transition",
                      selected
                        ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                        : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold">{option.title}</p>
                        <p className={selected ? "mt-2 text-sm text-white/80" : "mt-2 text-sm text-slate-600"}>
                          {option.description}
                        </p>
                      </div>
                      <span
                        className={[
                          "mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
                          selected
                            ? "border-white/40 bg-white/10 text-white"
                            : "border-slate-300 text-slate-500",
                        ].join(" ")}
                      >
                        {selected ? "●" : ""}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                Current choice
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">{selectedCopy.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{selectedCopy.description}</p>
              <p className="mt-6 text-sm text-slate-500">
                Flexivo will adapt the navigation, start screen, and dashboard context around this
                choice.
              </p>

              {error ? (
                <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleContinue}
                disabled={saving}
                className="mt-8 inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving…" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

(RoleSetupPage as any).hideGlobalHeader = true;
