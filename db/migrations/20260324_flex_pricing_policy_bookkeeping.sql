-- Flex pricing policy bookkeeping fields for auditable extension charging.

alter table if exists public.bookings
  add column if not exists flex_pricing_policy text,
  add column if not exists confirmed_total_pence integer,
  add column if not exists amount_paid_pence integer,
  add column if not exists latest_repriced_total_pence integer,
  add column if not exists discount_tier_applied text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'flex_pricing_policy'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'bookings_flex_pricing_policy_check'
  ) then
    alter table public.bookings
      add constraint bookings_flex_pricing_policy_check
      check (flex_pricing_policy in ('incremental_only', 'reprice_on_threshold'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'discount_tier_applied'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'bookings_discount_tier_applied_check'
  ) then
    alter table public.bookings
      add constraint bookings_discount_tier_applied_check
      check (discount_tier_applied in ('none', 'weekly', 'monthly'));
  end if;
end $$;

create index if not exists bookings_flex_pricing_policy_idx
  on public.bookings (flex_pricing_policy);
