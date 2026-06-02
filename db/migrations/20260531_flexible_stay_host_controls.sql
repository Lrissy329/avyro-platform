-- MVP flexible-stay host controls
-- Adds listing-level extension controls used by quote/create/widget flows.

alter table if exists public.listings
  add column if not exists flex_extension_notice_hours integer,
  add column if not exists flex_extension_pricing_mode text;

alter table if exists public.listings
  alter column flex_max_extension_nights set default 7,
  alter column flex_extension_notice_hours set default 24,
  alter column flex_extension_pricing_mode set default 'same_rate';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listings'
      and column_name = 'flex_max_extension_nights'
  ) and not exists (
    select 1 from pg_constraint where conname = 'listings_flex_max_extension_nights_check'
  ) then
    alter table public.listings
      add constraint listings_flex_max_extension_nights_check
      check (flex_max_extension_nights in (3, 7, 14, 30));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listings'
      and column_name = 'flex_extension_notice_hours'
  ) and not exists (
    select 1 from pg_constraint where conname = 'listings_flex_extension_notice_hours_check'
  ) then
    alter table public.listings
      add constraint listings_flex_extension_notice_hours_check
      check (flex_extension_notice_hours in (12, 24, 48, 72));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listings'
      and column_name = 'flex_extension_pricing_mode'
  ) and not exists (
    select 1 from pg_constraint where conname = 'listings_flex_extension_pricing_mode_check'
  ) then
    alter table public.listings
      add constraint listings_flex_extension_pricing_mode_check
      check (flex_extension_pricing_mode in ('same_rate', 'premium_10'));
  end if;
end $$;

update public.listings
set
  flex_max_extension_nights = case
    when coalesce(flex_max_extension_nights, 0) <= 3 then 3
    when coalesce(flex_max_extension_nights, 0) <= 7 then 7
    when coalesce(flex_max_extension_nights, 0) <= 14 then 14
    else 30
  end,
  flex_extension_notice_hours = coalesce(flex_extension_notice_hours, 24),
  flex_extension_pricing_mode = coalesce(flex_extension_pricing_mode, 'same_rate')
where coalesce(allow_flexible_stays, false) = true;
