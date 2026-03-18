import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";

import GuestVerificationPanel, {
  type GuestVerification,
} from "@/components/profile/GuestVerificationPanel";
import ProfileHeader, { type ProfileHeaderProfile } from "@/components/profile/ProfileHeader";
import { ensureProfile } from "@/lib/ensureProfile";
import { supabase } from "@/lib/supabaseClient";
import { GuestPageHeader } from "@/components/guest/GuestPageHeader";
import { GuestShellLayout } from "@/components/guest/GuestShellLayout";

export default function GuestProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileHeaderProfile | null>(null);
  const [verification, setVerification] = useState<GuestVerification | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
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

    const fallbackAvatar = user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null;

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
  }, [router]);

  useEffect(() => {
    loadProfile().catch(() => null);
  }, [loadProfile]);

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

  return (
    <GuestShellLayout activeNav="profile" title="Profile">
      <div className="space-y-8">
        <GuestPageHeader
          title="Profile"
          description="Manage your name, contact details, and verification status."
        />

        {loading ? (
          <main className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Loading profile…
          </main>
        ) : (
          <>
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
          </>
        )}
      </div>
    </GuestShellLayout>
  );
}
