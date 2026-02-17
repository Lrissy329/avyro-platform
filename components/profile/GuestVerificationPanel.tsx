import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type GuestVerification = {
  user_id?: string | null;
  work_email?: string | null;
  work_email_verified_at?: string | null;
  work_email_token_expires_at?: string | null;
  document_url?: string | null;
  document_type?: string | null;
  status?: string | null;
  review_notes?: string | null;
};

type Props = {
  userId: string;
  verification: GuestVerification | null;
  onRefresh: () => Promise<void> | void;
};

const DOC_TYPES = [
  "Crew ID",
  "Work ID",
  "Roster screenshot",
  "Payslip header",
];

export default function GuestVerificationPanel({ userId, verification, onRefresh }: Props) {
  const [workEmail, setWorkEmail] = useState(verification?.work_email ?? "");
  const [workStatus, setWorkStatus] = useState<string | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docStatus, setDocStatus] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [debugLink, setDebugLink] = useState<string | null>(null);

  useEffect(() => {
    setWorkEmail(verification?.work_email ?? "");
  }, [verification?.work_email]);

  const isWorkVerified = Boolean(verification?.work_email_verified_at);
  const workSent = useMemo(() => {
    if (!verification?.work_email_token_expires_at) return false;
    const exp = new Date(verification.work_email_token_expires_at);
    return Number.isFinite(exp.getTime()) && exp.getTime() > Date.now();
  }, [verification?.work_email_token_expires_at]);

  const workStatusLabel = isWorkVerified
    ? "Verified ✅"
    : workSent || workStatus === "sent"
    ? "Verification email sent"
    : "Unverified";

  const tier2Status = (verification?.status ?? "").toLowerCase();

  const handleStartVerification = async () => {
    if (!workEmail || !workEmail.includes("@")) {
      setWorkStatus("Please enter a valid work email.");
      return;
    }
    setWorkLoading(true);
    setWorkStatus(null);
    setDebugLink(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Please sign in again.");

      const resp = await fetch("/api/verify/work-email/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ workEmail }),
      });
      const payload = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(payload?.error ?? "Unable to send verification email.");
      }
      if (payload?.verificationUrl && process.env.NODE_ENV !== "production") {
        setDebugLink(payload.verificationUrl);
      }
      setWorkStatus("sent");
      await onRefresh();
    } catch (err: any) {
      setWorkStatus(err?.message ?? "Unable to send verification email.");
    } finally {
      setWorkLoading(false);
    }
  };

  const handleDocSubmit = async () => {
    if (!docFile) {
      setDocStatus("Please choose a document to upload.");
      return;
    }
    setDocLoading(true);
    setDocStatus(null);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeName = docFile.name.replace(/\s+/g, "-");
      const path = `${userId}/${timestamp}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("verification-docs")
        .upload(path, docFile, { upsert: true });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { error: verifyError } = await supabase
        .from("guest_verifications")
        .upsert(
          {
            user_id: userId,
            document_url: path,
            document_type: docType,
            status: "pending",
          },
          { onConflict: "user_id" }
        );

      if (verifyError) {
        throw new Error(verifyError.message);
      }

      await supabase
        .from("profiles")
        .update({ verification_status: "pending" })
        .eq("id", userId);

      setDocStatus("Submitted for review.");
      setDocFile(null);
      await onRefresh();
    } catch (err: any) {
      setDocStatus(err?.message ?? "Unable to submit document.");
    } finally {
      setDocLoading(false);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">Verification</h3>
      <p className="mt-1 text-sm text-slate-500">
        Verify only when needed for Instant Book or long stays.
      </p>

      <div className="mt-6 space-y-6">
        <div>
          <p className="text-sm font-semibold text-slate-900">Tier 1 · Work email</p>
          <p className="mt-1 text-sm text-slate-500">Unlocks Instant Book on standard listings.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="email"
              value={workEmail}
              onChange={(e) => setWorkEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full max-w-sm rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
              disabled={isWorkVerified}
            />
            <button
              type="button"
              onClick={handleStartVerification}
              disabled={workLoading || isWorkVerified}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {workLoading ? "Sending…" : "Verify work email"}
            </button>
            <span className="text-sm text-slate-500">{workStatusLabel}</span>
          </div>
          {workStatus && workStatus !== "sent" ? (
            <p className="mt-2 text-sm text-rose-600">{workStatus}</p>
          ) : null}
          {debugLink ? (
            <p className="mt-2 text-xs text-slate-500 break-all">
              Dev link: {debugLink}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-100 pt-6">
          <p className="text-sm font-semibold text-slate-900">Tier 2 · Document review</p>
          <p className="mt-1 text-sm text-slate-500">
            Required for crew-ready Instant Book and long stays.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-center">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="file"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <button
              type="button"
              onClick={handleDocSubmit}
              disabled={docLoading}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-60"
            >
              {docLoading ? "Submitting…" : "Submit for review"}
            </button>
          </div>

          <div className="mt-3 text-sm text-slate-600">
            Status: {tier2Status ? tier2Status.charAt(0).toUpperCase() + tier2Status.slice(1) : "Unsubmitted"}
          </div>
          {verification?.review_notes ? (
            <p className="mt-1 text-sm text-rose-600">Review notes: {verification.review_notes}</p>
          ) : null}
          {docStatus ? <p className="mt-2 text-sm text-slate-600">{docStatus}</p> : null}
        </div>
      </div>
    </section>
  );
}
