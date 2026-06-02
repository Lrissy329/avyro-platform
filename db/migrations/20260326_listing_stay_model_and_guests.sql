-- Stay model + occupancy support for create-listing flow

alter table if exists public.listings
  add column if not exists stay_model text,
  add column if not exists guests integer;

alter table if exists public.listings
  alter column stay_model set default 'standard',
  alter column guests set default 1;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listings'
      and column_name = 'stay_model'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'listings_stay_model_check'
  ) then
    alter table public.listings
      add constraint listings_stay_model_check
      check (stay_model in ('standard', 'flexible', 'shared', 'day_use', 'split_rest'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listings'
      and column_name = 'guests'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'listings_guests_check'
  ) then
    alter table public.listings
      add constraint listings_guests_check
      check (guests >= 1);
  end if;
end $$;

update public.listings
set stay_model = coalesce(
  stay_model,
  case
    when coalesce(is_shared_stay, false) = true then 'shared'
    when coalesce(allow_flexible_stays, false) = true then 'flexible'
    when rental_type = 'day_use' then 'day_use'
    when rental_type = 'split_rest' then 'split_rest'
    else 'standard'
  end
),
guests = coalesce(guests, 1)
where stay_model is null or guests is null;
