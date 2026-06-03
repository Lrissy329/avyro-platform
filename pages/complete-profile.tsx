import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import { buildRoleUpdates, getHostingHomeHref, getTravellingHomeHref, persistActiveRole, type PrimaryRole } from "@/lib/roleMode";

export default function CompleteProfile() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<PrimaryRole | "">("");
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        router.push("/login");
        return;
      }
      setUserId(user.id);
    };

    loadUser();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !role) return;

    const roleUpdates = buildRoleUpdates(role);

    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      full_name: fullName,
      ...roleUpdates,
    });

    if (!error) {
      persistActiveRole(roleUpdates.active_role);
      if (role === "both") {
        router.push("/select-role");
      } else if (role === "host") {
        const { count } = await supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        router.push(getHostingHomeHref((count ?? 0) > 0));
      } else {
        router.push(getTravellingHomeHref());
      }
    } else {
      alert("Error saving profile.");
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-gray-100">
      <div className="bg-white p-8 shadow rounded w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-6 text-center">Complete Your Profile</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-1 font-medium">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full border px-3 py-2 rounded"
              required
            />
          </div>

          <div>
            <label className="block mb-1 font-medium">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="w-full border px-3 py-2 rounded"
              required
            >
              <option value="">Select...</option>
              <option value="guest">Guest</option>
              <option value="host">Host</option>
              <option value="both">Both</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full bg-[#FEDD02] hover:bg-[#E6C902] active:bg-[#C9B002] text-black font-semibold py-2 rounded"
          >
            Save and Continue
          </button>
        </form>
      </div>
    </main>
  );
}
