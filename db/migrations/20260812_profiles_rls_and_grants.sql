-- Profiles security remediation -- Step 3 (RLS + grants).
--
-- Preconditions confirmed live before writing this migration:
--   - public.profiles currently has RLS DISABLED and zero policies.
--   - anon and authenticated both currently hold broad table-level
--     SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE grants on
--     public.profiles.
--   - profiles.id is the primary key.
--   - primary_role/active_role already carry CHECK constraints allowing
--     null (profiles_primary_role_check, profiles_active_role_check).
--   - profiles.updated_at does not exist -- not referenced anywhere below.
--   - is_host/is_guest exist as legacy columns with no confirmed live
--     reader beyond a dead hook; deliberately absent from every INSERT/
--     UPDATE grant below so they stay non-client-writable. SELECT is
--     re-granted at the table level (see step 3), which does let the
--     owner read these two columns on their own row via RLS, same as
--     every other column -- this migration does not attempt to hide
--     individual columns from the owner's own-row read, only to keep
--     every non-owner and every INSERT/UPDATE path away from them.
--
-- This migration does NOT touch public.public_profiles or the
-- sync_profiles_identity_from_auth_user trigger/function from Step 2a,
-- and does NOT touch public.bookings.
--
-- Ordering is deliberate and load-bearing: the broad revoke (step 2) MUST
-- run before the narrow column-level grants (steps 3-5), because
-- table-level and column-level privileges are additive in Postgres -- a
-- column-level GRANT does not narrow a pre-existing table-level GRANT, it
-- only adds to it. Applying the narrow grants first, or in a separate
-- migration, would leave the old broad grants doing all the actual
-- authorizing underneath, making the column restrictions decorative.
--
-- Rollback (manual; re-opens the vulnerability this migration closes --
-- treat as a last resort, not a routine option):
--   drop policy if exists profiles_select_own on public.profiles;
--   drop policy if exists profiles_insert_own on public.profiles;
--   drop policy if exists profiles_update_own on public.profiles;
--   alter table public.profiles disable row level security;
--   grant all privileges on public.profiles to anon, authenticated;

-- 1. Enable RLS.
begin;

alter table public.profiles enable row level security;

-- 2. Revoke ALL existing privileges from both roles, not just
-- SELECT/INSERT/UPDATE/DELETE. The live grants confirmed before this
-- migration was written also included REFERENCES, TRIGGER, and TRUNCATE.
-- TRUNCATE in particular is not governed by RLS at all -- it does not
-- evaluate rows, so no policy created below could ever restrict it; if it
-- were left granted, any authenticated user could wipe the entire table
-- regardless of everything else in this migration. Must run before every
-- grant statement below.
revoke all privileges on public.profiles from anon, authenticated;

-- 3. SELECT: authenticated only, table-level (RLS restricts rows to the
-- owner). anon receives no base-table SELECT at all -- its only path to
-- any profiles data remains public.public_profiles (Step 2a), unaffected
-- by this migration.
grant select on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- 4. INSERT: authenticated only, own row, column-restricted. email is
-- deliberately excluded -- it is system-managed exclusively by the Step 2a
-- auth.users trigger now. verification_level, verification_status,
-- stripe_account_id, stripe_onboarding_status, referred_by_sales_agent,
-- is_host, is_guest, and created_at are deliberately excluded and remain
-- service_role-only.
grant insert (id, full_name, primary_role, active_role, role_host, role_guest)
  on public.profiles to authenticated;

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- 5. UPDATE: authenticated only, own row, column-restricted. Same
-- exclusion list as INSERT, except id IS included here: empirically
-- validated against a disposable probe table (public._pgrst_upsert_probe,
-- same anon-key/authenticated-role/column-grant shape as this table, since
-- discarded) via a real signed-in test user. With UPDATE(id) revoked, the
-- conflict/upsert path (the same ON CONFLICT (id) DO UPDATE shape used by
-- complete-profile.tsx and role-setup.tsx) failed with code 42501
-- ("permission denied for table"); with UPDATE(id) granted, it succeeded.
-- PostgREST's generated SET clause for this upsert shape does include the
-- conflict-key column, so id must be grantable here. This is safe: the
-- value EXCLUDED.id can only ever equal what the INSERT policy already
-- constrained to auth.uid() at row-creation time, so granting UPDATE(id)
-- does not permit moving a row to a different id.
grant update (id, full_name, avatar_url, display_name, headline, bio, active_role, primary_role, role_host, role_guest)
  on public.profiles to authenticated;

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 6. DELETE: no grant, no policy, for either role. Deny by omission --
-- already covered by step 2's revoke; nothing below re-adds it.

commit;
