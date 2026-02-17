import { useEffect, useState } from "react";

export type HostProfile = {
  id: string;
  full_name?: string | null;
  display_name?: string | null;
  bio?: string | null;
};

type Props = {
  profile: HostProfile | null;
  onSave: (payload: { displayName: string; bio: string }) => Promise<void> | void;
};

export default function HostProfilePanel({ profile, onSave }: Props) {
  const [displayName, setDisplayName] = useState(profile?.display_name || profile?.full_name || "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.display_name || profile?.full_name || "");
    setBio(profile?.bio ?? "");
  }, [profile?.display_name, profile?.full_name, profile?.bio]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ displayName: displayName.trim(), bio: bio.trim() });
      setMessage("Profile updated.");
    } catch (err: any) {
      setMessage(err?.message ?? "Unable to update profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">Host details</h3>
      <p className="mt-1 text-sm text-slate-500">Share a short bio that appears on your listings.</p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-700">Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full max-w-sm rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save host profile"}
          </button>
          {message ? <span className="text-sm text-slate-500">{message}</span> : null}
        </div>
      </div>
    </section>
  );
}
