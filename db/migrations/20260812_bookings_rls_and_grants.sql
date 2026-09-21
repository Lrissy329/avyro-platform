-- Bookings security remediation -- Step 4 (RLS + grants).
--
-- Implements the bookings RLS design exactly as approved (Task 8). No
-- design decisions are made in this migration -- only mechanical
-- application of that design, plus the same REVOKE ALL PRIVILEGES
-- correction already established for profiles (Step 3), for the same
-- reason: TRUNCATE is not governed by RLS on any table, and is presumed
-- granted here too since it was confirmed granted on profiles from the
-- same live-grants check.
--
-- Preconditions confirmed live before writing this migration:
--   - public.bookings currently has RLS ENABLED already (unlike profiles).
--   - anon and authenticated both currently hold broad table-level grants.
--   - Five existing policies are live today: bookings_guest_cancel,
--     bookings_guest_insert, bookings_host_update_status,
--     "host can update own bookings" (a duplicate of the previous one),
--     and bookings_read_mine. All five are dropped below and replaced by
--     two policies matching the approved model.
--   - check_in, check_out, and stay_duration are GENERATED columns --
--     Postgres rejects any write to them regardless of grants, so no
--     privilege statement for them is possible or needed.
--   - needs_review is a staff/ops-only field (Task 7/8) with no legitimate
--     guest/host relevance; hidden from authenticated reads below.
--   - The nine flex/pricing-bookkeeping columns found referenced in code
--     but absent from the live schema (Task 7 sections 1-3) are untouched
--     by this migration -- they are not part of the client-writable
--     surface in the approved design either way.
--
-- This migration does NOT touch public.profiles, public.public_profiles,
-- or the Step 2a auth.users trigger. It does not touch the duplicate
-- bookings constraints/FKs flagged in Task 7 as schema-reconciliation
-- debt, not a P0 issue.
--
-- Rollback (manual; re-opens the vulnerabilities this migration closes --
-- treat as a last resort, not a routine option):
--   drop policy if exists bookings_select_own on public.bookings;
--   drop policy if exists bookings_update_own on public.bookings;
--   grant all privileges on public.bookings to anon, authenticated;

begin;

-- 1. Revoke ALL existing privileges from both roles first -- must run
-- before every grant statement below, for the same additive-privilege
-- reason documented in the profiles migration (Step 3): a narrower grant
-- added afterward does not revoke a broader grant already in place.
revoke all privileges on public.bookings from anon, authenticated;

-- 2. Replace the five existing policies with the two the approved design
-- calls for.
drop policy if exists bookings_guest_cancel on public.bookings;
drop policy if exists bookings_guest_insert on public.bookings;
drop policy if exists bookings_host_update_status on public.bookings;
drop policy if exists "host can update own bookings" on public.bookings;
drop policy if exists bookings_read_mine on public.bookings;
drop policy if exists bookings_select_own on public.bookings;
drop policy if exists bookings_update_own on public.bookings;

-- 3. SELECT: both parties on a booking (guest or host) can read the row --
-- this is the same relationship the row itself represents, so no public
-- view or relationship-endpoint layer is needed here, unlike profiles.
-- anon receives no base-table access at all.
--
-- needs_review is deliberately excluded from this list rather than
-- granted-then-revoked: a table-level GRANT SELECT authorizes every
-- column regardless of any column-level REVOKE issued afterward, since
-- Postgres checks column access against ANY applicable grant (table- or
-- column-level) -- a column-level revoke never narrows a table-level
-- grant, the same additive-privilege principle already documented for
-- INSERT/UPDATE elsewhere in this migration and in Step 3. Postgres has
-- no "all columns except X" grant shorthand, so this lists every other
-- live column (Task 7's confirmed 51-column schema, minus needs_review)
-- explicitly.
grant select (
  id, listing_id, guest_id, status, created_at, updated_at, host_id,
  guests_total, price_total, currency, message, stripe_checkout_session_id,
  stripe_payment_intent_id, amount, payout_status, payment_amount,
  payment_currency, payout_released_at, payout_transfer_id, check_in_time,
  check_out_time, stay_type, channel, stay_duration, check_in, check_out,
  host_net_total_pence, guest_total_pence, platform_fee_bps, stripe_var_bps,
  stripe_fixed_pence, pricing_version, nights, guest_unit_price_pence,
  stripe_status, flex_mode, flex_min_nights, flex_max_nights,
  flex_current_confirmed_end, flex_max_end, flex_rolling_window_days,
  flex_status, flex_pricing_multiplier, flex_last_extension_at,
  flex_extension_cutoff_at, booking_type, shared_group_id, flex_extra_night,
  flex_extra_night_price_pence, flex_extra_night_status
) on public.bookings to authenticated;

create policy bookings_select_own
  on public.bookings
  for select
  to authenticated
  using (auth.uid() in (guest_id, host_id));

-- 4. INSERT: intentionally no grant and no policy for authenticated or
-- anon. There is no legitimate browser-side booking-creation path -- the
-- real flow (pages/api/bookings/create.ts) is service_role-only. This is
-- also what makes the dead handleBooking() capability (Task 7/8, removed
-- in Step 5) actually inert rather than merely unused.

-- 5. UPDATE: both parties, own row, column-restricted to status only, and
-- the result is forced to 'cancelled' for both roles -- closing the
-- previously-unrestricted host UPDATE gap (D-9) symmetrically with the
-- guest side. All three legitimate cancel call sites (Task 7) already
-- send a status-only payload, so this requires no application change.
grant update (status) on public.bookings to authenticated;

create policy bookings_update_own
  on public.bookings
  for update
  to authenticated
  using (auth.uid() in (guest_id, host_id))
  with check (auth.uid() in (guest_id, host_id) and status = 'cancelled');

-- 6. DELETE: no grant, no policy, for either role. Deny by omission --
-- already covered by step 1's revoke; nothing above re-adds it.

commit;
