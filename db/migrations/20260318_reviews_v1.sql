-- Avyro Review System v1
-- Booking-linked blind reviews (guest->host/listing and host->guest)

create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),

  booking_id uuid not null references public.bookings(id) on delete cascade,

  reviewer_id uuid not null,
  reviewee_id uuid not null,

  reviewer_role text not null check (reviewer_role in ('guest', 'host')),
  review_type text not null check (review_type in ('guest_to_host', 'host_to_guest')),

  overall_score integer not null check (overall_score between 1 and 10),

  accuracy_score integer check (accuracy_score between 1 and 10),
  cleanliness_score integer check (cleanliness_score between 1 and 10),
  communication_score integer check (communication_score between 1 and 10),
  checkin_score integer check (checkin_score between 1 and 10),
  noise_score integer check (noise_score between 1 and 10),
  transport_score integer check (transport_score between 1 and 10),
  value_score integer check (value_score between 1 and 10),

  rules_score integer check (rules_score between 1 and 10),
  punctuality_score integer check (punctuality_score between 1 and 10),

  would_stay_again boolean,
  would_host_again boolean,

  public_comment text,
  private_note text,

  is_published boolean not null default false,
  review_window_expires_at timestamptz not null,
  published_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reviews_unique_guest_per_booking
on public.reviews (booking_id, reviewer_role)
where reviewer_role = 'guest';

create unique index if not exists reviews_unique_host_per_booking
on public.reviews (booking_id, reviewer_role)
where reviewer_role = 'host';

create index if not exists reviews_booking_id_idx on public.reviews (booking_id);
create index if not exists reviews_reviewee_id_idx on public.reviews (reviewee_id);
create index if not exists reviews_review_type_published_idx on public.reviews (review_type, is_published);
create index if not exists reviews_window_idx on public.reviews (is_published, review_window_expires_at);

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_reviews_updated_at on public.reviews;
create trigger set_reviews_updated_at
before update on public.reviews
for each row
execute procedure public.set_current_timestamp_updated_at();

