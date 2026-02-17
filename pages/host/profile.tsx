import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/ensureProfile";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import ProfileHeader, { type ProfileHeaderProfile } from "@/components/profile/ProfileHeader";
import HostProfilePanel from "@/components/profile/HostProfilePanel";

export default function HostProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileHeaderProfile | null>(null);
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
      .select("id, full_name, avatar_url, verification_level, verification_status, display_name, bio")
      .eq("id", user.id)
      .single();

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

  const handleHostSave = async (payload: { displayName: string; bio: string }) => {
    if (!profile?.id) return;
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: payload.displayName, bio: payload.bio })
      .eq("id", profile.id);
    if (error) throw new Error(error.message);
    setProfile((prev) =>
      prev ? { ...prev, display_name: payload.displayName, bio: payload.bio } : prev
    );
  };

  if (loading) {
    return (
      <HostShellLayout title="Profile" activeNav="profile">
        <p className="text-sm text-slate-600">Loading profile…</p>
      </HostShellLayout>
    );
  }

  return (
    <HostShellLayout title="Profile" activeNav="profile">
      <div className="space-y-6">
        <ProfileHeader
          profile={profile}
          onSaveName={handleSaveName}
          onUploadAvatar={handleAvatarUpload}
        />
        <HostProfilePanel
          profile={profile ? { ...profile } : null}
          onSave={handleHostSave}
        />
      </div>
    </HostShellLayout>
  );
}
