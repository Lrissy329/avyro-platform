import { useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";

export function useRedirectByRole() {
  const router = useRouter();

  useEffect(() => {
    const routeUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_host, is_guest")
        .eq("id", user.id)
        .single();

      if (profile?.is_host && !profile?.is_guest) {
        router.push("/host/dashboard");
      } else if (profile?.is_guest && !profile?.is_host) {
        router.push("/guest/dashboard");
      } else if (profile?.is_guest && profile?.is_host) {
        router.push("/select-role"); // Optional: let them pick
      } else {
        router.push("/role-setup"); // For fresh users
      }
    };

    routeUser();
  }, []);
}