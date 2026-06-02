-- Flex extra-night confirmation flow support

alter table if exists public.bookings
  add column if not exists flex_extra_night_cutoff_at timestamptz,
  add column if not exists flex_extra_night_confirmed_at timestamptz,
  add column if not exists flex_extra_night_released_at timestamptz,
  add column if not exists flex_extra_night_payment_intent_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'bookings'
      and constraint_name = 'bookings_flex_extra_night_status_check'
      and constraint_type = 'CHECK'
  ) then
    alter table public.bookings
      drop constraint bookings_flex_extra_night_status_check;
  end if;
end $$;

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
          check (flex_extra_night_status in ('reserved', 'used', 'released', 'expired'));
    exception
      when duplicate_object then
        null;
    end;
  end if;
end $$;
