-- P0-4 live-schema reconciliation: booking_flex_windows, listing_reviews,
-- shared_groups, shared_group_members.
--
-- This migration is based on CONFIRMED LIVE Supabase state, not the
-- repository's migration history, which was found to be out of sync with
-- reality during this reconciliation:
--
--   - public.reviews (created by db/migrations/20260318_reviews_v1.sql)
--     DOES NOT EXIST live. That migration describes a design that was
--     apparently never actually applied to this Supabase project. Do not
--     edit that historical migration file (migrations are immutable once
--     written) and do not create public.reviews here -- reviews are
--     FROZEN for MVP per product decision, and the app's entire
--     "reviews" code path (lib/reviewSystem.ts and everything that calls
--     it) already degrades gracefully to empty/skip against the missing
--     table via isMissingTableError() schema-drift handling. This
--     migration deliberately does not touch public.reviews at all.
--
--   - public.listing_reviews is the REAL live table actually serving
--     public listing-page review display (via
--     pages/api/reviews/listing.ts and pages/api/listings/[id]/reviews.ts,
--     both service-role, both read-only). It has zero writers and zero
--     direct-browser access anywhere in the app. RLS is confirmed OFF
--     live with broad anon/authenticated grants underneath.
--
--   - public.booking_flex_windows: confirmed live RLS OFF, broad grants,
--     zero direct-browser access anywhere (100% server/service-role,
--     traced across lib/flexAvailability.ts and every pages/api/flex/*
--     and pages/api/bookings/create.ts call site).
--
--   - public.shared_groups / public.shared_group_members: confirmed live
--     RLS already ON, but with ZERO policies -- meaning anon/authenticated
--     currently get zero rows on every read, regardless of the broad
--     grants underneath. This is not merely "insufficiently hardened" --
--     it is an active live bug: pages/search.tsx's shared-stay occupancy
--     query (the only direct-browser consumer of either table, reachable
--     while logged out) silently receives empty results (no error), so
--     every shared-stay listing in search currently displays as if it
--     has full, untouched availability regardless of real occupancy, and
--     existing groups can't be discovered for joining via search. The
--     actual join/start transaction (pages/api/shared-groups/options.ts,
--     checkout.ts) is unaffected since it's service-role -- only the
--     search-page pre-filter/badge is broken. This migration restores
--     the intended behavior with a narrow, non-sensitive column grant.
--
-- Because broad default-style grants already exist underneath the
-- currently-inert RLS on shared_groups/shared_group_members, REVOKE ALL
-- runs before the narrow GRANT SELECT below on every table -- granting a
-- permissive policy without first revoking the broad table-wide grant
-- would immediately expose every column, including the Stripe/PII ones
-- on shared_group_members, the moment the policy made rows visible.
--
-- Rollback (manual; restores the pre-migration state -- RLS OFF for
-- booking_flex_windows/listing_reviews, RLS ON with zero policies for
-- shared_groups/shared_group_members, broad grants restored on all four):
--   alter table public.booking_flex_windows disable row level security;
--   alter table public.listing_reviews disable row level security;
--   grant all on public.booking_flex_windows to anon, authenticated;
--   grant all on public.listing_reviews to anon, authenticated;
--   revoke all on public.shared_groups from anon, authenticated;
--   revoke all on public.shared_group_members from anon, authenticated;
--   grant all on public.shared_groups to anon, authenticated;
--   grant all on public.shared_group_members to anon, authenticated;
--   drop policy if exists shared_groups_select_public on public.shared_groups;
--   drop policy if exists shared_group_members_select_public on public.shared_group_members;

begin;

-- ---------------------------------------------------------------------
-- booking_flex_windows -- full deny, server-only
-- ---------------------------------------------------------------------

alter table public.booking_flex_windows enable row level security;
revoke all on public.booking_flex_windows from anon, authenticated;

-- ---------------------------------------------------------------------
-- listing_reviews -- the real live review table; full deny, server-only.
-- Service-role reads (pages/api/reviews/listing.ts,
-- pages/api/listings/[id]/reviews.ts) are unaffected -- service_role
-- bypasses RLS and grants entirely. public.reviews is intentionally not
-- referenced anywhere in this migration -- see header note.
-- ---------------------------------------------------------------------

alter table public.listing_reviews enable row level security;
revoke all on public.listing_reviews from anon, authenticated;

-- ---------------------------------------------------------------------
-- shared_groups -- RLS already enabled live; narrow the grant and add
-- the missing public policy so search's public availability display
-- works again, without exposing anything not already needed.
-- ---------------------------------------------------------------------

revoke all on public.shared_groups from anon, authenticated;
grant select (id, listing_id, start_date, end_date, total_spots, status)
on public.shared_groups to anon, authenticated;

drop policy if exists shared_groups_select_public on public.shared_groups;
create policy shared_groups_select_public
on public.shared_groups
for select
to anon, authenticated
using (status in ('open', 'full', 'closed'));

-- ---------------------------------------------------------------------
-- shared_group_members -- RLS already enabled live; same treatment.
-- user_id, amount_paid_pence, stripe_checkout_session_id, and
-- stripe_payment_intent_id are never granted under any circumstance.
-- ---------------------------------------------------------------------

revoke all on public.shared_group_members from anon, authenticated;
grant select (shared_group_id, status, reservation_expires_at)
on public.shared_group_members to anon, authenticated;

drop policy if exists shared_group_members_select_public on public.shared_group_members;
create policy shared_group_members_select_public
on public.shared_group_members
for select
to anon, authenticated
using (status in ('pending', 'confirmed'));

commit;
