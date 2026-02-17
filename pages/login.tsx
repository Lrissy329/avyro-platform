// pages/login.tsx
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";

function getRedirect(raw: string | string[] | undefined): string {
  if (!raw) return "/";
  const first = Array.isArray(raw) ? raw[0] : raw;
  try {
    const decoded = decodeURIComponent(first);
    if (!decoded.startsWith("/")) return "/";
    const url = new URL(decoded, "http://localhost");
    if (url.origin !== "http://localhost") return "/";
    // Normalise to avoid //double slashes or protocol-relative inputs.
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export default function LoginPage() {
  const router = useRouter();

  // Wait until the router is ready before reading query or redirecting
  const redirect = useMemo(() => {
    if (!router.isReady) return "/";
    return getRedirect(router.query.redirect);
  }, [router.isReady, router.query.redirect]);

  // Auth form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Helper to safely navigate (avoid abort error if already on path)
  const safeReplace = (path: string) => {
    if (router.asPath !== path) {
      router.replace(path);
    }
  };

  // If already logged in, go straight to redirect (when router is ready)
  useEffect(() => {
    if (!router.isReady) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (!session || cancelled) return;

      // If we have a redirect target, go there
      if (redirect) {
        safeReplace(redirect);
        return;
      }

      // Fallback: role-based routing
      const { data: profile } = await supabase
        .from("profiles")
        .select("role_host, role_guest")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profile?.role_host && !profile?.role_guest) safeReplace("/host/dashboard");
      else if (profile?.role_guest && !profile?.role_host) safeReplace("/guest/dashboard");
      else if (profile?.role_host && profile?.role_guest) safeReplace("/select-role");
      else safeReplace("/role-setup");
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, redirect]);

  // Email/password sign-in
  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      safeReplace(redirect || "/");
    } catch (err: any) {
      setErrorMsg(err?.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  // Email/password sign-up (simple)
  const signUp = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setSuccessMsg("Account created. You can sign in now.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  // OAuth sign-in (Google / GitHub), preserving redirect
  const signInWithProvider = async (provider: "google" | "github") => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/login?redirect=${encodeURIComponent(redirect || "/")}`,
        },
      });
      if (error) setErrorMsg(error.message);
      // Supabase will take over navigation
    } catch (err: any) {
      setErrorMsg(err?.message || "Unexpected error");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white border rounded-2xl p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-gray-600 mb-6">
          You’ll be sent back to <code>{redirect}</code> after signing in.
        </p>

        <form onSubmit={signIn} className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border-gray-300 focus:ring-black focus:border-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border-gray-300 focus:ring-black focus:border-black"
            />
          </div>

          {errorMsg && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="text-sm text-[#0B0D10] bg-[#14FF62]/15 border border-[#14FF62]/40 rounded p-2">
              {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white rounded-lg py-2.5 hover:bg-gray-900 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px bg-gray-200 flex-1" />
          <span className="text-xs text-gray-500">or</span>
          <div className="h-px bg-gray-200 flex-1" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => signInWithProvider("github")}
            disabled={loading}
            className="border rounded-lg py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Continue with GitHub
          </button>
          <button
            onClick={() => signInWithProvider("google")}
            disabled={loading}
            className="border rounded-lg py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Continue with Google
          </button>
        </div>

        <div className="mt-6 text-sm text-gray-600">
          New here?{" "}
          <button
            onClick={signUp}
            disabled={loading}
            className="text-black underline underline-offset-2 disabled:opacity-50"
          >
            Create an account
          </button>
        </div>
      </div>
    </main>
  );
}
