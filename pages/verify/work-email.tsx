import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";

export default function WorkEmailVerifyPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("Verifying…");

  useEffect(() => {
    if (!router.isReady) return;
    const token = router.query.token;
    if (!token || typeof token !== "string") {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }

    const run = async () => {
      try {
        const resp = await fetch(`/api/verify/work-email/confirm?token=${encodeURIComponent(token)}`);
        const payload = await resp.json().catch(() => null);
        if (!resp.ok) {
          throw new Error(payload?.error ?? "Unable to verify email.");
        }
        setStatus("success");
        setMessage("Work email verified.");
      } catch (err: any) {
        setStatus("error");
        setMessage(err?.message ?? "Verification failed.");
      }
    };

    run();
  }, [router.isReady, router.query.token]);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Work email verification</h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
        <div className="mt-6">
          {status === "success" ? (
            <Link
              href="/guest/profile?tab=verification"
              className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Continue to profile
            </Link>
          ) : (
            <Link href="/guest/profile" className="text-sm text-slate-600 underline">
              Go back to profile
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
