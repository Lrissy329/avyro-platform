import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";

type RoleSwitcherProps = {
  tone?: "light" | "dark";
  className?: string;
};

export function RoleSwitcher({ tone = "light", className = "" }: RoleSwitcherProps = {}) {
  const router = useRouter();
  const [isHost, setIsHost] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_host, is_guest")
        .eq("id", user.id)
        .single();

      if (profile) {
        setIsHost(Boolean(profile.is_host));
        setIsGuest(Boolean(profile.is_guest));
      }

      setLoading(false);
    };

    loadProfile();
  }, []);

  const buttonClass = useMemo(() => {
    const toneStyles =
      tone === "dark"
        ? "border-white/80 text-white hover:bg-white/10"
        : "border-gray-300 text-gray-800 hover:bg-gray-100";
    return `inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium transition ${toneStyles}`;
  }, [tone]);

  const updateRole = async (newRole: "host" | "guest") => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    const updates =
      newRole === "host"
        ? { is_host: true }
        : { is_guest: true };

    const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);

    if (error) {
      alert("Error updating role.");
      return;
    }

    router.push(`/${newRole}/dashboard`);
  };

  if (loading) return null;

  if (!isHost && !isGuest) {
    return null;
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {isHost && (
        <button onClick={() => router.push("/host/dashboard")} className={buttonClass}>
          Host view
        </button>
      )}
      {isGuest && (
        <button onClick={() => router.push("/guest/dashboard")} className={buttonClass}>
          Guest view
        </button>
      )}
      {!isHost && (
        <button onClick={() => updateRole("host")} className={buttonClass}>
          Become a host
        </button>
      )}
      {!isGuest && (
        <button onClick={() => updateRole("guest")} className={buttonClass}>
          Become a guest
        </button>
      )}
    </div>
  );
}
