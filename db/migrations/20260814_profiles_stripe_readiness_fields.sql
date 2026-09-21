-- Payments Phase 2 -- P0-A (host Stripe readiness fields).
--
-- Adds the two columns the host-readiness gate (P0-C through P0-F) will
-- check before any charge path allows a booking: profiles.charges_enabled
-- and profiles.payouts_enabled, mirroring the two booleans Stripe reports
-- directly on the Connect Account object. profiles.stripe_onboarding_status
-- already exists (used by the account.updated handler since before this
-- migration) and is untouched here.
--
-- Both columns are additive, nullable, no default -- null means "not yet
-- known" (no account.updated received yet for this host), distinct from
-- false ("Stripe reported this is not enabled"). The readiness gate treats
-- both null and false as not-ready, so this distinction doesn't need to be
-- special-cased by callers -- it only matters for not overclaiming a
-- host's state before Stripe has actually reported it.
--
-- Client grants are deliberately untouched. Step 3
-- (20260812_profiles_rls_and_grants.sql) already grants SELECT on
-- public.profiles to authenticated at the table level (not column-scoped),
-- so a host can already read these two new columns on their own row via
-- the existing profiles_select_own policy -- no SELECT grant change is
-- needed for that. Step 3's INSERT/UPDATE grants are column-scoped
-- allowlists that do not name these two columns, and this migration does
-- not add them to any allowlist, so authenticated/anon get no write access
-- to either column -- only the service-role client (used by the Stripe
-- webhook handler) can write them, same as stripe_onboarding_status today.
--
-- Rollback (manual):
--   alter table public.profiles drop column if exists charges_enabled;
--   alter table public.profiles drop column if exists payouts_enabled;

begin;

alter table public.profiles
  add column if not exists charges_enabled boolean,
  add column if not exists payouts_enabled boolean;

commit;
