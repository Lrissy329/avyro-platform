import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export type ProfileHeaderProfile = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  verification_level?: number | null;
  verification_status?: string | null;
};

type Props = {
  profile: ProfileHeaderProfile | null;
  onSaveName: (name: string) => Promise<void> | void;
  onUploadAvatar: (file: File) => Promise<void> | void;
};

const statusStyles: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
  unverified: "bg-slate-100 text-slate-600 border-slate-200",
};

const resolveStatus = (profile: ProfileHeaderProfile | null) => {
  const raw = (profile?.verification_status ?? "").toLowerCase();
  if (raw === "verified" || raw === "pending" || raw === "rejected") return raw;
  if ((profile?.verification_level ?? 0) >= 1) return "verified";
  return "unverified";
};

export default function ProfileHeader({ profile, onSaveName, onUploadAvatar }: Props) {
  const [name, setName] = useState(profile?.full_name ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setName(profile?.full_name ?? "");
  }, [profile?.full_name]);

  const status = resolveStatus(profile);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name cannot be empty.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSaveName(name.trim());
    } catch (err: any) {
      setError(err?.message ?? "Unable to save name.");
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await onUploadAvatar(file);
    } catch (err: any) {
      setError(err?.message ?? "Unable to upload avatar.");
    } finally {
      setUploading(false);
    }
  };

  const initials = (profile?.full_name || profile?.email || "U").slice(0, 2).toUpperCase();

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border border-slate-200">
            <AvatarImage src={profile?.avatar_url ?? ""} alt={profile?.full_name ?? "Profile"} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 hover:border-slate-300"
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Upload avatar"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex-1 min-w-[240px]">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold text-slate-900">Profile</h2>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                statusStyles[status]
              }`}
            >
              {status === "verified" && "Verified"}
              {status === "pending" && "Pending"}
              {status === "rejected" && "Rejected"}
              {status === "unverified" && "Unverified"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{profile?.email ?? ""}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full max-w-sm rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
