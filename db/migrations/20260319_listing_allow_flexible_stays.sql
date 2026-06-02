-- Listing-level control for optional extra-night availability

alter table if exists public.listings
  add column if not exists allow_flexible_stays boolean not null default true;
