import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/ensureProfile";
import { AppHeader } from "@/components/AppHeader";
import ProfileHeader, { type ProfileHeaderProfile } from "@/components/profile/ProfileHeader";
import GuestVerificationPanel, { type GuestVerification } from "@/components/profile/GuestVerificationPanel";

export default function GuestProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileHeaderProfile | null>(null);
  const [verification, setVerification] = useState<GuestVerification | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      router.push("/login");
      return;
    }

    await ensureProfile();

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, verification_level, verification_status")
      .eq("id", user.id)
      .single();

    const { data: verificationRow } = await supabase
      .from("guest_verifications")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const fallbackAvatar =
      user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null;

    const profileData = profileRow
      ? {
          ...profileRow,
          avatar_url: profileRow.avatar_url ?? fallbackAvatar,
        }
      : {
          id: user.id,
          full_name: user.user_metadata?.full_name ?? user.email ?? null,
          avatar_url: fallbackAvatar,
          verification_level: 0,
          verification_status: "unverified",
        };
    setProfile({
      ...profileData,
      email: user.email ?? null,
    });
    setVerification((verificationRow as GuestVerification) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleSaveName = async (name: string) => {
    if (!profile?.id) return;
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", profile.id);
    if (error) throw new Error(error.message);
    setProfile((prev) => (prev ? { ...prev, full_name: name } : prev));
  };

  const handleAvatarUpload = async (file: File) => {
    if (!profile?.id) return;
    const path = `${profile.id}/avatar.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = data?.publicUrl ?? null;
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", profile.id);
    if (updateError) throw new Error(updateError.message);
    setProfile((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
  };

  if (loading) {
    return <main className="min-h-screen bg-slate-50 p-6 text-slate-600">Loading profile…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Your profile</h1>
          <p className="mt-2 text-sm text-slate-500">
            Manage your work verification and guest settings.
          </p>
        </div>

        <ProfileHeader
          profile={profile}
          onSaveName={handleSaveName}
          onUploadAvatar={handleAvatarUpload}
        />

        {profile?.id ? (
          <GuestVerificationPanel
            userId={profile.id}
            verification={verification}
            onRefresh={loadProfile}
          />
        ) : null}
      </div>
    </main>
  );
}
