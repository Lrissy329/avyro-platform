import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { AppHeader } from "@/components/AppHeader";

type PendingItem = {
  user_id: string;
  work_email?: string | null;
  document_type?: string | null;
  document_url?: string | null;
  status?: string | null;
  review_notes?: string | null;
  profile?: {
    full_name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } | null;
};

export default function AdminVerificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const loadItems = async () => {
    setLoading(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      router.push("/login");
      return;
    }

    const resp = await fetch("/api/admin/verifications/review", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const payload = await resp.json().catch(() => null);
    if (!resp.ok) {
      setError(payload?.error ?? "Unable to load verifications.");
      setLoading(false);
      return;
    }
    setItems(payload?.items ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadItems();
  }, []);

  const handleAction = async (userId: string, action: "approve" | "reject") => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      router.push("/login");
      return;
    }

    const resp = await fetch("/api/admin/verifications/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId, action, notes: notes[userId] }),
    });
    const payload = await resp.json().catch(() => null);
    if (!resp.ok) {
      alert(payload?.error ?? "Unable to update verification.");
      return;
    }
    await loadItems();
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Verification reviews</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review Tier 2 document submissions.
        </p>

        {loading ? (
          <p className="mt-6 text-sm text-slate-600">Loading…</p>
        ) : error ? (
          <p className="mt-6 text-sm text-rose-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="mt-6 text-sm text-slate-600">No pending verifications.</p>
        ) : (
          <div className="mt-6 space-y-4">
            {items.map((item) => (
              <div
                key={item.user_id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {item.profile?.full_name ?? "Guest"}
                    </p>
                    <p className="text-sm text-slate-500">{item.profile?.email}</p>
                    {item.work_email ? (
                      <p className="mt-1 text-xs text-slate-500">Work email: {item.work_email}</p>
                    ) : null}
                  </div>
                  <div className="text-sm text-slate-600">
                    <div>Doc type: {item.document_type ?? "—"}</div>
                    <div className="break-all">Path: {item.document_url ?? "—"}</div>
                  </div>
                </div>

                <div className="mt-4">
                  <textarea
                    placeholder="Review notes (optional)"
                    value={notes[item.user_id] ?? ""}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [item.user_id]: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleAction(item.user_id, "approve")}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleAction(item.user_id, "reject")}
                    className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
