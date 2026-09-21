-- P0-1 DB-layer hardening: close the direct-Supabase bypass of the paid-
-- booking cancellation fix.
--
-- Context: the app-level fix (lib/bookingStatus.ts: canSelfCancelBooking)
-- already blocks guest/host self-cancel of a paid/effectively-paid
-- booking through the UI and the host cancel API route. But the live
-- bookings_update_own RLS policy only checks ROW OWNERSHIP
-- (auth.uid() = guest_id or host_id) and only constrains the RESULT to
-- status = 'cancelled' -- it never inspects the row's CURRENT status or
-- stripe_status before allowing the update, and it never restricts which
-- OTHER columns can change in the same statement. A guest or host could
-- therefore bypass the app-level fix entirely by issuing a direct
-- Supabase UPDATE from the browser, and (separately) could smuggle
-- changes to any other column into that same UPDATE as long as the
-- final status ended up 'cancelled'.
--
-- This migration is surgical: only the UPDATE privilege on public.bookings
-- and the bookings_update_own policy are touched. SELECT/INSERT grants
-- and any other existing bookings policy (established during this
-- engagement's earlier RLS hardening work) are left completely alone.
--
-- Traced every live browser-direct UPDATE against bookings before writing
-- this: post-P0-1, exactly two exist (pages/guest/bookings/[id].tsx,
-- pages/host/bookings/[id].tsx), both already client-gated by
-- canSelfCancelBooking, and both only ever set { status: "cancelled" } --
-- no other column is ever directly browser-written to bookings anywhere
-- in the app. Restricting the UPDATE grant to the status column alone
-- therefore does not break any legitimate live flow.
--
-- Rollback (manual; restores the pre-migration policy exactly as
-- reported live before this change):
--   revoke update on public.bookings from authenticated;
--   grant update on public.bookings to authenticated;
--   drop policy if exists bookings_update_own on public.bookings;
--   create policy bookings_update_own
--   on public.bookings
--   for update
--   to authenticated
--   using (auth.uid() = guest_id or auth.uid() = host_id)
--   with check (
--     (auth.uid() = guest_id or auth.uid() = host_id)
--     and status = 'cancelled'
--   );

begin;

revoke update on public.bookings from anon, authenticated;
grant update (status) on public.bookings to authenticated;

drop policy if exists bookings_update_own on public.bookings;
create policy bookings_update_own
on public.bookings
for update
to authenticated
using (
  (auth.uid() = guest_id or auth.uid() = host_id)
  and status not in ('paid', 'confirmed', 'completed')
  and (
    stripe_status is null
    or lower(stripe_status) not in ('paid', 'succeeded', 'complete')
  )
)
with check (
  (auth.uid() = guest_id or auth.uid() = host_id)
  and status = 'cancelled'
);

commit;
