-- Rolling flex stay support

alter table if exists public.bookings
  add column if not exists flex_mode text,
  add column if not exists flex_min_nights integer,
  add column if not exists flex_max_nights integer,
  add column if not exists flex_current_confirmed_end date,
  add column if not exists flex_max_end date,
  add column if not exists flex_rolling_window_days integer,
  add column if not exists flex_status text,
  add column if not exists flex_pricing_multiplier numeric(6,3),
  add column if not exists flex_last_extension_at timestamptz,
  add column if not exists flex_extension_cutoff_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'flex_mode'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'bookings_flex_mode_check'
  ) then
    alter table public.bookings
      add constraint bookings_flex_mode_check
      check (flex_mode in ('none', 'extra_night', 'rolling'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'flex_status'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'bookings_flex_status_check'
  ) then
    alter table public.bookings
      add constraint bookings_flex_status_check
      check (flex_status in ('inactive', 'active', 'ended', 'released', 'expired'));
  end if;
end $$;

create table if not exists public.booking_flex_windows (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('held', 'confirmed', 'released', 'expired')),
  cutoff_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_flex_windows_date_range_check check (start_date < end_date)
);

create index if not exists booking_flex_windows_booking_idx
  on public.booking_flex_windows (booking_id);

create index if not exists booking_flex_windows_status_idx
  on public.booking_flex_windows (status, cutoff_at);

create unique index if not exists booking_flex_windows_one_held_per_booking
  on public.booking_flex_windows (booking_id)
  where status = 'held';

alter table if exists public.listings
  add column if not exists allow_flexible_stays boolean default false,
  add column if not exists flexible_stay_mode text,
  add column if not exists flex_min_commitment_nights integer default 1,
  add column if not exists flex_max_extension_nights integer default 0,
  add column if not exists flex_rolling_window_days integer default 0,
  add column if not exists flex_pricing_multiplier numeric(6,3) default 1.0;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listings'
      and column_name = 'flexible_stay_mode'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'listings_flexible_stay_mode_check'
  ) then
    alter table public.listings
      add constraint listings_flexible_stay_mode_check
      check (flexible_stay_mode in ('none', 'extra_night', 'rolling'));
  end if;
end $$;

