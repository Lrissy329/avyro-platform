-- Optional extra night support (booking-level + host settings)

alter table if exists public.bookings
  add column if not exists flex_extra_night boolean not null default false,
  add column if not exists flex_extra_night_price_pence integer,
  add column if not exists flex_extra_night_status text not null default 'released';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'flex_extra_night_status'
  ) then
    begin
      alter table public.bookings
        add constraint bookings_flex_extra_night_status_check
          check (flex_extra_night_status in ('reserved', 'used', 'released'));
    exception
      when duplicate_object then
        null;
    end;
  end if;
end $$;

alter table if exists public.host_settings
  add column if not exists allow_flexible_stays boolean not null default false,
  add column if not exists flexible_stay_extra_night_modifier_pct integer not null default 10;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'host_settings'
      and column_name = 'flexible_stay_extra_night_modifier_pct'
  ) then
    begin
      alter table public.host_settings
        add constraint host_settings_flexible_modifier_pct_check
          check (flexible_stay_extra_night_modifier_pct between 0 and 100);
    exception
      when duplicate_object then
        null;
    end;
  end if;
end $$;
