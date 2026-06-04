alter table if exists public.profiles
  add column if not exists headline text,
  add column if not exists bio text;
