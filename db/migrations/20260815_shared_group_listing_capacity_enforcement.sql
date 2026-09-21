-- Shared-stay capacity model, Stage 2: DB-level listing-wide enforcement.
--
-- Stage 1 (application code) added an app-level aggregate-capacity check
-- (lib/sharedGroupsDb.ts: checkListingSharedCapacityForRange), used by both
-- pages/api/shared-groups/checkout.ts and options.ts. That check is
-- advisory only -- a plain SELECT with no lock, so it cannot by itself
-- prevent two concurrent requests targeting DIFFERENT overlapping groups on
-- the SAME listing from both passing the check before either write commits,
-- jointly overselling a shared night. shared_total_spots is a hard
-- physical-capacity invariant per product decision, so this migration
-- makes the existing trg_enforce_shared_group_capacity trigger (defined in
-- db/migrations/20260325_shared_crew_stays_mvp.sql) the actual, race-safe
-- enforcement point.
--
-- This migration ONLY replaces that trigger function's body via
-- `create or replace function` -- same function name, same trigger
-- (`before insert or update on shared_group_members`), so the existing
-- `drop trigger / create trigger` statements from the original migration
-- do not need to run again; Postgres picks up the new function body in
-- place. No table shape or index changes: shared_groups_listing_date_idx
-- (listing_id, start_date, end_date), already created in the original
-- migration, is sufficient to support the new listing-wide overlap query
-- below -- nothing new is demonstrably required.
--
-- shared_groups_unique_active_window is untouched.
--
-- Rollback (manual; reverts to the original per-group-only enforcement --
-- re-opens the cross-group overselling gap this migration closes):
--   create or replace function public.enforce_shared_group_capacity()
--   returns trigger
--   language plpgsql
--   as $fn$
--   declare
--     group_total_spots integer;
--     active_spot_count integer;
--   begin
--     if new.status not in ('pending', 'confirmed') then
--       return new;
--     end if;
--
--     select total_spots
--     into group_total_spots
--     from public.shared_groups
--     where id = new.shared_group_id
--     for update;
--
--     if group_total_spots is null then
--       raise exception 'SHARED_GROUP_NOT_FOUND';
--     end if;
--
--     select count(*)
--     into active_spot_count
--     from public.shared_group_members members
--     where members.shared_group_id = new.shared_group_id
--       and members.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
--       and (
--         members.status = 'confirmed'
--         or (
--           members.status = 'pending'
--           and (
--             members.reservation_expires_at is null
--             or members.reservation_expires_at > now()
--           )
--         )
--       );
--
--     if active_spot_count >= group_total_spots then
--       raise exception 'SHARED_GROUP_FULL';
--     end if;
--
--     return new;
--   end
--   $fn$;

begin;

create or replace function public.enforce_shared_group_capacity()
returns trigger
language plpgsql
as $fn$
declare
  v_listing_id uuid;
  v_group_start date;
  v_group_end date;
  v_listing_total_spots integer;
  v_group_total_spots integer;
  v_same_group_active_count integer;
  v_worst_night_count integer;
begin
  if new.status not in ('pending', 'confirmed') then
    return new;
  end if;

  -- Resolve the affected group's own listing/date-range. Reading this
  -- without a lock is safe: a shared_group_members row's shared_group_id,
  -- and a shared_groups row's listing_id/start_date/end_date, are never
  -- mutated after creation anywhere in the app -- only status/filled_spots
  -- change, via the separate refresh_shared_group_occupancy trigger.
  select sg.listing_id, sg.start_date, sg.end_date, sg.total_spots
  into v_listing_id, v_group_start, v_group_end, v_group_total_spots
  from public.shared_groups sg
  where sg.id = new.shared_group_id;

  if v_listing_id is null then
    raise exception 'SHARED_GROUP_NOT_FOUND';
  end if;

  -- Lock the LISTING row, not just the group row. This is what closes the
  -- cross-group race: every insert/update into shared_group_members for
  -- ANY shared_groups row belonging to this listing now serializes on the
  -- same lock, so two concurrent reservations against different
  -- overlapping groups can no longer both read a stale occupancy count
  -- before either commits.
  select l.shared_total_spots
  into v_listing_total_spots
  from public.listings l
  where l.id = v_listing_id
  for update;

  if v_listing_total_spots is null then
    raise exception 'SHARED_LISTING_NOT_FOUND';
  end if;

  -- Same-group capacity: unchanged from the original per-group check.
  -- Kept alongside the new aggregate check per explicit product decision
  -- ("same-group capacity remains covered"), and as defense-in-depth in
  -- case a future group is ever given a total_spots smaller than the full
  -- listing capacity.
  select count(*)
  into v_same_group_active_count
  from public.shared_group_members members
  where members.shared_group_id = new.shared_group_id
    and members.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      members.status = 'confirmed'
      or (
        members.status = 'pending'
        and (
          members.reservation_expires_at is null
          or members.reservation_expires_at > now()
        )
      )
    );

  if v_same_group_active_count >= v_group_total_spots then
    raise exception 'SHARED_GROUP_FULL';
  end if;

  -- Listing-wide aggregate capacity: for every night in the affected
  -- group's own [start_date, end_date), sum active occupancy across ALL
  -- overlapping groups for the same listing whose status is open, full, OR
  -- closed -- closed means "not joinable", not "guests vacated", so
  -- confirmed/pending members of a closed group still physically occupy
  -- spots and must still count (product decision). Reject if any night
  -- would exceed the listing's real capacity once this row is counted.
  select max(night_count)
  into v_worst_night_count
  from (
    select count(*) as night_count
    from generate_series(
      v_group_start::timestamp,
      (v_group_end - interval '1 day')::timestamp,
      interval '1 day'
    ) as nights(night)
    join public.shared_groups sg2
      on sg2.listing_id = v_listing_id
      and sg2.status in ('open', 'full', 'closed')
      and sg2.start_date <= nights.night::date
      and sg2.end_date > nights.night::date
    join public.shared_group_members m2
      on m2.shared_group_id = sg2.id
      and m2.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and (
        m2.status = 'confirmed'
        or (
          m2.status = 'pending'
          and (m2.reservation_expires_at is null or m2.reservation_expires_at > now())
        )
      )
    group by nights.night
  ) nightly_counts;

  if coalesce(v_worst_night_count, 0) + 1 > v_listing_total_spots then
    raise exception 'SHARED_LISTING_CAPACITY_EXCEEDED';
  end if;

  return new;
end
$fn$;

commit;
