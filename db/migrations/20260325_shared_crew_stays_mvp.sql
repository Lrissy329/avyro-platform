-- Shared Crew Stays MVP schema

alter table if exists public.listings
  add column if not exists is_shared_stay boolean not null default false,
  add column if not exists shared_total_spots integer,
  add column if not exists shared_weekly_price_pence integer,
  add column if not exists shared_join_mode text,
  add column if not exists shared_min_weeks integer,
  add column if not exists shared_max_weeks integer;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listings'
      and column_name = 'shared_join_mode'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'listings_shared_join_mode_check'
  ) then
    alter table public.listings
      add constraint listings_shared_join_mode_check
      check (shared_join_mode in ('open', 'approval'));
  end if;
end $$;

alter table if exists public.listings
  alter column shared_join_mode set default 'open',
  alter column shared_min_weeks set default 1,
  alter column shared_max_weeks set default 12;

create table if not exists public.shared_groups (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  total_spots integer not null,
  filled_spots integer not null default 0,
  status text not null default 'open'
    check (status in ('open', 'full', 'closed', 'cancelled')),
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_groups_date_range_check check (start_date < end_date),
  constraint shared_groups_total_spots_check check (total_spots > 0),
  constraint shared_groups_filled_spots_check check (filled_spots >= 0)
);

create index if not exists shared_groups_listing_date_idx
  on public.shared_groups (listing_id, start_date, end_date);

create unique index if not exists shared_groups_unique_active_window
  on public.shared_groups (listing_id, start_date, end_date)
  where status in ('open', 'full', 'closed');

create index if not exists shared_groups_status_idx
  on public.shared_groups (status);

create table if not exists public.shared_group_members (
  id uuid primary key default gen_random_uuid(),
  shared_group_id uuid not null references public.shared_groups(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled')),
  amount_paid_pence integer not null default 0,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  reservation_expires_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_group_members_amount_paid_check check (amount_paid_pence >= 0)
);

create index if not exists shared_group_members_group_idx
  on public.shared_group_members (shared_group_id, status);

create index if not exists shared_group_members_user_idx
  on public.shared_group_members (user_id);

create unique index if not exists shared_group_members_unique_user_per_group
  on public.shared_group_members (shared_group_id, user_id);

alter table if exists public.bookings
  add column if not exists booking_type text not null default 'standard',
  add column if not exists shared_group_id uuid references public.shared_groups(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'booking_type'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'bookings_booking_type_check'
  ) then
    alter table public.bookings
      add constraint bookings_booking_type_check
      check (booking_type in ('standard', 'shared_group'));
  end if;
end $$;

create index if not exists bookings_booking_type_idx
  on public.bookings (booking_type);

create index if not exists bookings_shared_group_id_idx
  on public.bookings (shared_group_id);

do $$
begin
  if not exists (
    select 1
    from pg_proc
    where proname = 'shared_group_members_set_updated_at'
      and pg_function_is_visible(oid)
  ) then
    create function public.shared_group_members_set_updated_at()
    returns trigger
    language plpgsql
    as $fn$
    begin
      new.updated_at = now();
      return new;
    end
    $fn$;
  end if;
end $$;

drop trigger if exists trg_shared_group_members_set_updated_at on public.shared_group_members;
create trigger trg_shared_group_members_set_updated_at
before update on public.shared_group_members
for each row
execute function public.shared_group_members_set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_proc
    where proname = 'enforce_shared_group_capacity'
      and pg_function_is_visible(oid)
  ) then
    create function public.enforce_shared_group_capacity()
    returns trigger
    language plpgsql
    as $fn$
    declare
      group_total_spots integer;
      active_spot_count integer;
    begin
      if new.status not in ('pending', 'confirmed') then
        return new;
      end if;

      select total_spots
      into group_total_spots
      from public.shared_groups
      where id = new.shared_group_id
      for update;

      if group_total_spots is null then
        raise exception 'SHARED_GROUP_NOT_FOUND';
      end if;

      select count(*)
      into active_spot_count
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

      if active_spot_count >= group_total_spots then
        raise exception 'SHARED_GROUP_FULL';
      end if;

      return new;
    end
    $fn$;
  end if;
end $$;

drop trigger if exists trg_enforce_shared_group_capacity on public.shared_group_members;
create trigger trg_enforce_shared_group_capacity
before insert or update on public.shared_group_members
for each row
execute function public.enforce_shared_group_capacity();

do $$
begin
  if not exists (
    select 1
    from pg_proc
    where proname = 'refresh_shared_group_occupancy'
      and pg_function_is_visible(oid)
  ) then
    create function public.refresh_shared_group_occupancy()
    returns trigger
    language plpgsql
    as $fn$
    declare
      target_group_id uuid;
      confirmed_count integer;
      occupied_count integer;
      total_spots_count integer;
      current_status text;
      next_status text;
    begin
      target_group_id = coalesce(new.shared_group_id, old.shared_group_id);
      if target_group_id is null then
        return coalesce(new, old);
      end if;

      select
        sg.total_spots,
        sg.status,
        coalesce(sum(case when members.status = 'confirmed' then 1 else 0 end), 0),
        coalesce(sum(case when members.status = 'confirmed' then 1 when members.status = 'pending' and (members.reservation_expires_at is null or members.reservation_expires_at > now()) then 1 else 0 end), 0)
      into total_spots_count, current_status, confirmed_count, occupied_count
      from public.shared_groups sg
      left join public.shared_group_members members
        on members.shared_group_id = sg.id
      where sg.id = target_group_id
      group by sg.id;

      if total_spots_count is null then
        return coalesce(new, old);
      end if;

      next_status =
        case
          when current_status in ('closed', 'cancelled') then current_status
          when occupied_count >= total_spots_count then 'full'
          else 'open'
        end;

      update public.shared_groups
      set
        filled_spots = confirmed_count,
        status = next_status,
        updated_at = now()
      where id = target_group_id;

      return coalesce(new, old);
    end
    $fn$;
  end if;
end $$;

drop trigger if exists trg_refresh_shared_group_occupancy on public.shared_group_members;
create trigger trg_refresh_shared_group_occupancy
after insert or update or delete on public.shared_group_members
for each row
execute function public.refresh_shared_group_occupancy();
