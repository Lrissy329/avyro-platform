import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export const UserBar = () => {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      setUserEmail(user.email);

      // Step 1: Check if profile exists
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .single();

      // Step 2: If not, insert it
      if (!profile && !error) {
        await supabase.from("profiles").insert([
          {
            id: user.id,
            full_name: user.user_metadata?.name ?? "",
            avatar_url: user.user_metadata?.avatar_url ?? "",
            is_guest: true,
            is_host: false,
          },
        ]);
      }
    };

    init();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  if (!userEmail) return null;

  return (
  <div className="bg-slate-100 border border-slate-200 text-slate-600 px-4 py-2 rounded mb-4 flex justify-between items-center">
      <span>👋 Welcome, {userEmail}</span>
      <button
        onClick={handleLogout}
        className="text-sm text-[#FEDD02] hover:underline hover:text-[#E6C902]"
      >
        Log out
      </button>
    </div>
  );
};
