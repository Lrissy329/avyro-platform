-- Earliest public-transport departure (local "HH:MM") a guest could catch from about 04:00, found by
-- /api/transport/refresh. Lets the listing card say "first service 05:10" so crew with early reports are
-- not shown a bus time for a service that is not running yet.
-- Additive and nullable: the app keeps working (and simply omits this) until the migration is applied.
alter table public.listing_transport_summaries
  add column if not exists public_transport_first_departure text;
