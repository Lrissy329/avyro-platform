import { supabase } from "@/lib/supabaseClient";

type EnsureProfileResult = {
  userId: string | null;
};

const resolveDisplayName = (user: any): string | null => {
  const meta = user?.user_metadata ?? {};
  const name = meta.full_name || meta.name || meta.fullName || meta.display_name || meta.displayName;
  if (typeof name === "string" && name.trim()) return name.trim();
  if (typeof user?.email === "string" && user.email.includes("@")) {
    return user.email.split("@")[0];
  }
  return null;
};

export async function ensureProfile(): Promise<EnsureProfileResult> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.user) {
    return { userId: null };
  }

  const user = session.user;
  const fullName = resolveDisplayName(user);
  const email = user.email ?? null;

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email,
      full_name: fullName,
    },
    { onConflict: "id" }
  );

  if (profileError) {
    console.error("[ensureProfile] failed to upsert profile", profileError.message);
  }

  const { error: verificationError } = await supabase.from("guest_verifications").upsert(
    {
      user_id: user.id,
    },
    { onConflict: "user_id" }
  );

  if (verificationError) {
    console.error("[ensureProfile] failed to ensure guest_verifications", verificationError.message);
  }

  return { userId: user.id };
}
