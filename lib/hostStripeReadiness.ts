import { getSupabaseServerClient } from "@/lib/supabaseServer";

export type HostStripeReadiness = {
  ready: boolean;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export async function getHostStripeReadiness(hostId: string): Promise<HostStripeReadiness> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("stripe_account_id, charges_enabled, payouts_enabled")
    .eq("id", hostId)
    .maybeSingle();

  if (error) {
    throw new Error(`[hostStripeReadiness] failed to load host profile: ${error.message}`);
  }

  const stripeAccountId = data?.stripe_account_id ?? null;
  const chargesEnabled = data?.charges_enabled === true;
  const payoutsEnabled = data?.payouts_enabled === true;

  return {
    ready: Boolean(stripeAccountId) && chargesEnabled && payoutsEnabled,
    stripeAccountId,
    chargesEnabled,
    payoutsEnabled,
  };
}
