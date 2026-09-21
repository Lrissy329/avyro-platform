-- Profiles security remediation -- Step 2a (additive only).
--
-- This migration is intentionally additive and non-breaking:
--   - It does NOT enable RLS on public.profiles (see the follow-up
--     "profiles RLS/grants" migration).
--   - It does NOT change any existing grant on public.profiles.
--   - It does NOT touch application code.
--   - It creates two new, independent objects: an auth.users -> profiles
--     identity sync trigger, and a public_profiles view for public-safe
--     cross-user reads. Neither object is consumed by any application code
--     yet.
--
-- Rollback (manual, run in this order if needed):
--   drop trigger if exists sync_profiles_identity_on_auth_user_change on auth.users;
--   drop function if exists public.sync_profiles_identity_from_auth_user();
--   drop view if exists public.public_profiles;

-- 1. auth.users -> profiles identity synchronization
--
-- This function is the authoritative creator of a profiles row: it fires on
-- every auth.users INSERT (signup) and seeds id, email, and a best-effort
-- full_name from signup/OAuth metadata. It also fires on UPDATE OF email
-- (a later email change) but in that case only ever touches email --
-- full_name is never included in the ON CONFLICT SET clause, so a row that
-- already exists (whether seeded by this trigger or since edited by the
-- user via the profile page) never has its full_name overwritten by a
-- later-firing email-change event. One statement correctly covers both
-- trigger events: on first insert there is no conflict, so the full VALUES
-- list (including full_name) applies; on a later email-only change the row
-- already exists, so only the SET clause (email) applies and the unused
-- full_name expression in VALUES is simply discarded.
--
-- full_name fallback order, matching lib/ensureProfile.ts's existing
-- resolveDisplayName() precedence so behavior is consistent with what the
-- client already does today: user_metadata.full_name, .name, .fullName,
-- .display_name, .displayName, then the email local-part, then null. Empty/
-- whitespace-only strings are treated as absent via nullif(trim(...), '').
--
-- SECURITY DEFINER is required: this function must be able to write to
-- public.profiles regardless of the RLS state that will be applied to that
-- table in a later migration, and regardless of who/what triggers an
-- auth.users change (signup happens via Supabase's own auth service, not a
-- session-bound authenticated/anon role). search_path is pinned to empty and
-- every identifier is schema-qualified to avoid search_path hijacking, per
-- Postgres/Supabase's documented SECURITY DEFINER guidance. pg_catalog is
-- always implicitly searched regardless of this setting, so built-in
-- operators/functions (jsonb ->>, split_part, coalesce, nullif, trim) are
-- unaffected.
create or replace function public.sync_profiles_identity_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_full_name text;
begin
  resolved_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'fullName'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'displayName'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), '')
  );

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, resolved_full_name)
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists sync_profiles_email_on_auth_user_change on auth.users;
drop trigger if exists sync_profiles_identity_on_auth_user_change on auth.users;

create trigger sync_profiles_identity_on_auth_user_change
after insert or update of email on auth.users
for each row
execute function public.sync_profiles_identity_from_auth_user();

revoke execute on function public.sync_profiles_identity_from_auth_user() from public;
revoke execute on function public.sync_profiles_identity_from_auth_user() from anon;
revoke execute on function public.sync_profiles_identity_from_auth_user() from authenticated;

drop function if exists public.sync_profiles_email_from_auth_user();

-- 2. public_profiles view
--
-- Deliberately a DEFAULT (non security_invoker) view: it must be able to
-- return every qualifying host's public-safe fields regardless of the
-- owner-only RLS policy that will later be applied to public.profiles. This
-- will very likely be flagged by Supabase's "Security Definer View" linter --
-- that is expected and reviewed here, not an oversight. The safety guarantee
-- comes from the column allowlist below (a hard exclusion of email,
-- verification_level, stripe_account_id, stripe_onboarding_status,
-- referred_by_sales_agent, and every other sensitive column), not from row
-- filtering -- RLS on the base table cannot restrict this view's columns
-- either way, since the view simply doesn't select them.
--
-- Scope: only profiles belonging to a user who has created at least one
-- listing. Pure-guest accounts can never appear here. This is a snapshot of
-- what's already publicly reachable via search/listing pages today, since
-- listings has no publish/suspend flag yet -- see the security design notes
-- for the planned follow-up once that exists.
create or replace view public.public_profiles as
select
  p.id,
  p.full_name,
  p.avatar_url,
  p.display_name,
  p.headline,
  p.bio,
  (p.verification_status = 'verified') as is_verified
from public.profiles p
where exists (
  select 1 from public.listings l where l.user_id = p.id
);

grant select on public.public_profiles to anon, authenticated;
