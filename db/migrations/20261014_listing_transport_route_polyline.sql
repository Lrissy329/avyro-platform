-- Driving route geometry (Google's encoded polyline format) from the same Directions lookup
-- /api/transport/refresh already performs and pays for to get the drive-time estimate. Previously
-- only duration/distance were kept and the route geometry in that same response was discarded.
-- Capturing it costs no additional API calls. Lets the listing page draw the actual road route
-- from the stay to the airport, not just show a travel-time number.
-- Additive and nullable: the app keeps working (and simply omits the route) until applied.
alter table public.listing_transport_summaries
  add column if not exists driving_route_polyline text;
