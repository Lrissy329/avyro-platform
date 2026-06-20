import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/ensureProfile";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import ProfileHeader, { type ProfileHeaderProfile } from "@/components/profile/ProfileHeader";
import HostProfilePanel from "@/components/profile/HostProfilePanel";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HostPageHeader } from "@/components/host/HostPageHeader";

export default function HostProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileHeaderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [stripeMeta, setStripeMeta] = useState<{
    accountId: string | null;
    onboardingStatus: string | null;
    emailVerified: boolean;
  }>({ accountId: null, onboardingStatus: null, emailVerified: false });

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
      .select(
        "id, full_name, avatar_url, verification_level, verification_status, display_name, bio, stripe_account_id, stripe_onboarding_status"
      )
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
    setStripeMeta({
      accountId: (profileRow as any)?.stripe_account_id ?? null,
      onboardingStatus: (profileRow as any)?.stripe_onboarding_status ?? null,
      emailVerified: Boolean(user.email_confirmed_at || (user as any).confirmed_at),
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
        <div className="space-y-8">
          <HostPageHeader
            title="Profile"
            description="Update your public host profile and account badges."
          />
          <p className="text-sm text-slate-600">Loading profile…</p>
        </div>
      </HostShellLayout>
    );
  }

  return (
    <HostShellLayout title="Profile" activeNav="profile">
      <div className="space-y-8">
        <HostPageHeader
          title="Profile"
          description="Update your public host profile and account badges."
        />
        <ProfileHeader
          profile={profile}
          onSaveName={handleSaveName}
          onUploadAvatar={handleAvatarUpload}
        />
        <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Badges</h3>
          <p className="mt-1 text-sm text-slate-500">
            These badges show guests which account details are confirmed.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Badge
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                stripeMeta.emailVerified
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-50 text-slate-500 border-slate-200"
              }`}
            >
              {stripeMeta.emailVerified ? "Email verified" : "Email unverified"}
            </Badge>
            <Badge
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                stripeMeta.onboardingStatus === "complete"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : stripeMeta.accountId
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-slate-50 text-slate-500 border-slate-200"
              }`}
            >
              {stripeMeta.onboardingStatus === "complete"
                ? "Stripe connected"
                : stripeMeta.accountId
                  ? "Stripe setup incomplete"
                  : "Stripe not connected"}
            </Badge>
          </div>
        </Card>
        <HostProfilePanel
          profile={profile ? { ...profile } : null}
          onSave={handleHostSave}
        />
      </div>
    </HostShellLayout>
  );
}
