alter table if exists public.profiles
  add column if not exists primary_role text,
  add column if not exists active_role text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'primary_role'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'profiles_primary_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_primary_role_check
      check (primary_role in ('guest', 'host', 'both') or primary_role is null);
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'active_role'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'profiles_active_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_active_role_check
      check (active_role in ('guest', 'host') or active_role is null);
  end if;
end $$;

update public.profiles
set primary_role = case
      when coalesce(role_host, false) and coalesce(role_guest, false) then 'both'
      when coalesce(role_host, false) then 'host'
      when coalesce(role_guest, false) then 'guest'
      else primary_role
    end
where primary_role is null;

update public.profiles
set active_role = case
      when primary_role = 'host' then 'host'
      when primary_role = 'guest' then 'guest'
      when primary_role = 'both' then 'guest'
      else active_role
    end
where active_role is null;
