// One-off backfill: sync charges_enabled / payouts_enabled / stripe_onboarding_status
// for every existing connected host, direct from the live Stripe Account object.
//
// Why this exists: profiles.charges_enabled and profiles.payouts_enabled
// (added in db/migrations/20260814_profiles_stripe_readiness_fields.sql) are
// only populated going forward by the stripe-webhook.ts account.updated
// handler. Hosts who connected Stripe before that migration ships have both
// columns null and will not get a fresh account.updated event until Stripe
// happens to send one -- this script closes that gap once, for existing
// hosts only, by asking Stripe directly rather than inferring anything from
// stripe_onboarding_status (which this script treats as write-only output,
// never as a read-side signal).
//
// Usage:
//   node scripts/backfill-host-stripe-readiness.mjs
//   node scripts/backfill-host-stripe-readiness.mjs --dry-run
//
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
// STRIPE_SECRET_KEY from .env.local / .env (same loader convention as
// scripts/smoke-rolling-flex.mjs). Never logs any secret, token, or key --
// only profile ids and the three booleans/status being written. Safe to
// rerun: each run re-fetches the current Stripe state and overwrites the
// same three columns with it, so repeated runs converge, they don't
// accumulate. Not an HTTP endpoint -- there is nothing here for the app to
// expose, and it must only ever be run locally/by an operator with access
// to the real service-role and Stripe secret keys.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const ENV_FILES = [".env.local", ".env"];

const log = (message, data) => {
  if (data === undefined) {
    console.log(`[backfill:host-stripe-readiness] ${message}`);
    return;
  }
  console.log(`[backfill:host-stripe-readiness] ${message}`, data);
};

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] != null) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
};

for (const envFile of ENV_FILES) {
  loadEnvFile(path.join(process.cwd(), envFile));
}

const requiredEnv = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const dryRun = process.argv.includes("--dry-run");

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

async function main() {
  const { data: profiles, error: fetchError } = await supabaseAdmin
    .from("profiles")
    .select("id, stripe_account_id")
    .not("stripe_account_id", "is", null);

  if (fetchError) {
    throw new Error(`Failed to load connected-host profiles: ${fetchError.message}`);
  }

  if (!profiles || profiles.length === 0) {
    log("No profiles with a stripe_account_id found. Nothing to do.");
    return;
  }

  log(`Found ${profiles.length} connected host profile(s).${dryRun ? " (dry run -- no writes will be made)" : ""}`);

  let updated = 0;
  let failed = 0;

  for (const profile of profiles) {
    const profileId = profile.id;

    let account;
    try {
      account = await stripe.accounts.retrieve(profile.stripe_account_id);
    } catch (err) {
      failed += 1;
      log(`FAILED (Stripe retrieve) profile=${profileId}: ${err?.message ?? "unknown error"}`);
      continue;
    }

    const readiness = {
      stripe_onboarding_status: account?.details_submitted ? "complete" : "incomplete",
      charges_enabled: account?.charges_enabled === true,
      payouts_enabled: account?.payouts_enabled === true,
    };

    if (dryRun) {
      log(`DRY RUN profile=${profileId}`, readiness);
      updated += 1;
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update(readiness)
      .eq("id", profileId);

    if (updateError) {
      failed += 1;
      log(`FAILED (Supabase update) profile=${profileId}: ${updateError.message}`);
      continue;
    }

    updated += 1;
    log(`OK profile=${profileId}`, readiness);
  }

  log(`Done. ${updated} updated, ${failed} failed, ${profiles.length} total.`);
}

main().catch((err) => {
  log(`Fatal error: ${err?.message ?? "unknown error"}`);
  process.exitCode = 1;
});
