import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase service role configuration for Stripe account link handler.");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

const DEFAULT_BUSINESS_PROFILE = {
  url: "https://aeronooc.com",
  mcc: "7011",
  product_description: "Short-term accommodation for aviation personnel",
  support_url: "https://aeronooc.com/support",
  support_phone: "+443330903210",
} as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    const { userId } = req.body as { userId?: string };
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id, full_name")
      .eq("id", userId)
      .single();

    if (profErr) return res.status(400).json({ error: profErr.message });

    let accountId = profile?.stripe_account_id as string | null;

    if (!accountId) {
      let hostEmail: string | undefined;
      try {
        const { data: userRecord } = await supabaseAdmin.auth.admin.getUserById(userId);
        hostEmail = userRecord?.user?.email ?? undefined;
      } catch (adminErr: any) {
        console.error("[stripe] failed to fetch host email", adminErr?.message);
      }

      const businessProfile: Record<string, any> = {
        ...DEFAULT_BUSINESS_PROFILE,
      };

      if (hostEmail) {
        businessProfile.support_email = hostEmail;
      }

      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        email: hostEmail,
        default_currency: "gbp",
        business_profile: businessProfile,
        metadata: {
          platform: "aeronooc",
          host_user_id: userId,
          host_name: profile?.full_name ?? undefined,
        },
        settings: {
          payouts: {
            schedule: {
              interval: "daily",
            },
            statement_descriptor: "AERONOOC STAY",
          },
        },
      });

      accountId = account.id;

      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({
          stripe_account_id: accountId,
          stripe_onboarding_status: "created",
        })
        .eq("id", userId);

      if (upErr) return res.status(500).json({ error: upErr.message });
    } else {
      try {
        const existing = await stripe.accounts.retrieve(accountId);
        const updatePayload: Record<string, any> = {};

        if (!existing.email) {
          try {
            const { data: userRecord } = await supabaseAdmin.auth.admin.getUserById(userId);
            const hostEmail = userRecord?.user?.email ?? undefined;
            if (hostEmail) updatePayload.email = hostEmail;
          } catch (adminErr: any) {
            console.error("[stripe] failed to refresh host email", adminErr?.message);
          }
        }

        if (existing.default_currency !== "gbp") {
          updatePayload.default_currency = "gbp";
        }

        const businessProfileUpdates: Record<string, any> = {};
        if (!existing.business_profile?.url) businessProfileUpdates.url = DEFAULT_BUSINESS_PROFILE.url;
        if (!existing.business_profile?.mcc) businessProfileUpdates.mcc = DEFAULT_BUSINESS_PROFILE.mcc;
        if (!existing.business_profile?.product_description)
          businessProfileUpdates.product_description = DEFAULT_BUSINESS_PROFILE.product_description;
        if (!existing.business_profile?.support_url)
          businessProfileUpdates.support_url = DEFAULT_BUSINESS_PROFILE.support_url;
        if (!existing.business_profile?.support_phone)
          businessProfileUpdates.support_phone = DEFAULT_BUSINESS_PROFILE.support_phone;
        if (!existing.business_profile?.support_email && existing.email) {
          businessProfileUpdates.support_email = existing.email;
        }
        if (Object.keys(businessProfileUpdates).length > 0) {
          updatePayload.business_profile = businessProfileUpdates;
        }

        const metadataUpdates: Record<string, string> = {};
        if (!existing.metadata?.platform) metadataUpdates.platform = "aeronooc";
        if (!existing.metadata?.host_user_id && userId) metadataUpdates.host_user_id = userId;
        if (!existing.metadata?.host_name && profile?.full_name) {
          metadataUpdates.host_name = profile.full_name;
        }
        if (Object.keys(metadataUpdates).length > 0) {
          updatePayload.metadata = metadataUpdates;
        }

        const payoutSchedule = existing.settings?.payouts?.schedule;
        if (!payoutSchedule || payoutSchedule.interval !== "daily") {
          updatePayload.settings = {
            payouts: {
              schedule: {
                interval: "daily",
              },
            },
          };
        }

        if (Object.keys(updatePayload).length > 0) {
          await stripe.accounts.update(accountId, updatePayload);
        }
      } catch (err: any) {
        console.error("[stripe] failed to prefill existing account", err?.message);
      }
    }

    const origin = req.headers.origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/host/dashboard?onboarding=refresh`,
      return_url: `${origin}/host/dashboard?onboarding=return`,
      type: "account_onboarding",
    });

    return res.status(200).json({ url: accountLink.url });
  } catch (e: any) {
    console.error("[stripe] account link creation error", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
