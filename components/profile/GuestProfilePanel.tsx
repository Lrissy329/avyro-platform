import { useEffect, useMemo, useState } from "react";

export type GuestProfileDetails = {
  full_name?: string | null;
  headline?: string | null;
  bio?: string | null;
};

type Props = {
  profile: GuestProfileDetails | null;
  onSave: (payload: { headline: string; bio: string }) => Promise<void> | void;
};

const HEADLINE_LIMIT = 80;
const BIO_LIMIT = 280;

export default function GuestProfilePanel({ profile, onSave }: Props) {
  const [headline, setHeadline] = useState(profile?.headline ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setHeadline(profile?.headline ?? "");
    setBio(profile?.bio ?? "");
  }, [profile?.bio, profile?.headline]);

  const trimmedHeadline = useMemo(() => headline.trim(), [headline]);
  const trimmedBio = useMemo(() => bio.trim(), [bio]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await onSave({
        headline: trimmedHeadline,
        bio: trimmedBio,
      });
      setMessage("Guest profile updated.");
    } catch (err: any) {
      setMessage(err?.message ?? "Unable to update guest profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Guest profile</h3>
          <p className="mt-1 text-sm text-slate-500">
            Keep your public guest profile current so hosts know who is booking.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_320px]">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-slate-700">Headline</label>
              <span className="text-xs text-slate-400">{headline.length}/{HEADLINE_LIMIT}</span>
            </div>
            <input
              type="text"
              value={headline}
              maxLength={HEADLINE_LIMIT}
              onChange={(event) => setHeadline(event.target.value)}
              placeholder="Example: Cabin crew based in London"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-slate-700">Bio</label>
              <span className="text-xs text-slate-400">{bio.length}/{BIO_LIMIT}</span>
            </div>
            <textarea
              value={bio}
              maxLength={BIO_LIMIT}
              onChange={(event) => setBio(event.target.value)}
              rows={5}
              placeholder="Share a short intro, your travel rhythm, or what makes a stay easy for you."
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          {message ? <p className="text-sm text-slate-500">{message}</p> : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Public Preview
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-lg font-semibold text-slate-900">
                {profile?.full_name?.trim() || "Your name will appear here"}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-600">
                {trimmedHeadline || "Add a short headline to tell hosts who you are."}
              </p>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              {trimmedBio || "Add a short bio so hosts can understand your travel style and preferences."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
