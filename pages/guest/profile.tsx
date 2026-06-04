import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import GuestProfileCompletionCard from "@/components/profile/GuestProfileCompletionCard";
import GuestProfilePanel from "@/components/profile/GuestProfilePanel";
import GuestProfilePreviewCard from "@/components/profile/GuestProfilePreviewCard";
import GuestVerificationPanel from "@/components/profile/GuestVerificationPanel";
import ProfileHeader, { type ProfileHeaderProfile } from "@/components/profile/ProfileHeader";
import { ensureProfile } from "@/lib/ensureProfile";
import { supabase } from "@/lib/supabaseClient";
import { GuestPageHeader } from "@/components/guest/GuestPageHeader";
import { GuestShellLayout } from "@/components/guest/GuestShellLayout";

export default function GuestProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileHeaderProfile | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
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
      .select("id, full_name, avatar_url, headline, bio, verification_level, verification_status")
      .eq("id", user.id)
      .single();

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
    setEmailVerified(Boolean(user.email_confirmed_at || (user as any).confirmed_at));
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
    const avatarUrl = data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", profile.id);

    if (updateError) throw new Error(updateError.message);
    setProfile((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
  };

  const handleSaveGuestProfile = async (payload: { headline: string; bio: string }) => {
    if (!profile?.id) return;
    const { error } = await supabase
      .from("profiles")
      .update({
        headline: payload.headline,
        bio: payload.bio,
      })
      .eq("id", profile.id);

    if (error) throw new Error(error.message);

    setProfile((prev) =>
      prev
        ? {
            ...prev,
            headline: payload.headline,
            bio: payload.bio,
          }
        : prev
    );
  };

  const completionItems = useMemo(
    () => [
      {
        label: "Avatar",
        complete: Boolean(profile?.avatar_url),
        hint: "Upload a recognisable profile photo.",
      },
      {
        label: "Full name",
        complete: Boolean(profile?.full_name?.trim()),
        hint: "Use the name hosts should expect on bookings.",
      },
      {
        label: "Headline",
        complete: Boolean(profile?.headline?.trim()),
        hint: "Add a short line about who you are.",
      },
      {
        label: "Bio",
        complete: Boolean(profile?.bio?.trim()),
        hint: "Share context that helps hosts prepare for your stay.",
      },
      {
        label: "Email verification",
        complete: emailVerified,
        hint: "Your login email should be confirmed on the account.",
      },
    ],
    [emailVerified, profile?.avatar_url, profile?.bio, profile?.full_name, profile?.headline]
  );

  return (
    <GuestShellLayout activeNav="profile" title="Profile">
      <div className="space-y-8">
        <GuestPageHeader
          title="Profile"
          description="Manage the public guest profile hosts see before they accept a booking."
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
              details={
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                      Headline
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {profile?.headline?.trim() || "Add a short headline so hosts know who you are."}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                      Bio
                    </p>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                      {profile?.bio?.trim() ||
                        "Add a brief bio to help hosts understand your travel style and preferences."}
                    </p>
                  </div>
                </div>
              }
            />

            <div className="grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_380px]">
              <GuestProfilePanel profile={profile} onSave={handleSaveGuestProfile} />
              <div className="space-y-6">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">Public preview</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    This is the profile summary hosts see before accepting a booking.
                  </p>
                  <div className="mt-4">
                    <GuestProfilePreviewCard
                      profile={profile}
                      emailVerified={emailVerified}
                      showProfessionalPlaceholder
                      meta={
                        <p className="text-xs text-slate-500">
                          Sensitive details stay private. Hosts only see your public guest profile.
                        </p>
                      }
                    />
                  </div>
                </section>
                <GuestProfileCompletionCard items={completionItems} />
              </div>
            </div>

            <GuestVerificationPanel emailVerified={emailVerified} />
          </>
        )}
      </div>
    </GuestShellLayout>
  );
}
