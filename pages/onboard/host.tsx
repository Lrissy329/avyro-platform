import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";

type InviteInfo = {
  leadId: string;
  email: string | null;
  status: string | null;
  expiresAt: string | null;
};

export default function HostOnboardPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady || !token) return;
    const run = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const resp = await fetch(`/api/onboard/host/validate?token=${token}`);
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload?.error ?? "Invite invalid");
        setInvite(payload);
      } catch (err: any) {
        setMessage(err?.message ?? "Invite invalid");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router.isReady, token]);

  const handleLogin = () => {
    router.push(`/login?redirect=${encodeURIComponent(`/onboard/host?token=${token}`)}`);
  };

  const handleClaim = async () => {
    setMessage("Claiming invite...");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        handleLogin();
        return;
      }

      const resp = await fetch(`/api/onboard/host/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ token }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Failed to claim invite");
      router.push("/host/create-listing");
    } catch (err: any) {
      setMessage(err?.message ?? "Failed to claim invite");
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12">
      <div className="mx-auto max-w-xl rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Host onboarding</h1>
        <p className="mt-2 text-sm text-gray-600">
          Complete your host onboarding to start listing with Avyro.
        </p>

        {loading ? (
          <p className="mt-6 text-sm text-gray-500">Checking invite…</p>
        ) : invite ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <div>Invite email: {invite.email ?? "—"}</div>
              <div>Expires: {invite.expiresAt ?? "—"}</div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleClaim}
                className="rounded-xl bg-black px-5 py-2 text-sm font-semibold text-white"
              >
                Continue onboarding
              </button>
              <button
                onClick={handleLogin}
                className="rounded-xl border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-900"
              >
                Sign in / Sign up
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-red-600">{message ?? "Invite invalid."}</p>
        )}

        {message && invite && (
          <p className="mt-4 text-sm text-gray-500">{message}</p>
        )}
      </div>
    </main>
  );
}
