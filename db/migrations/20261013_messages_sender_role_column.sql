-- Add messages.sender_role for real.
--
-- Found during the messaging deep dive: MessagesPanel.tsx, host/MessagingTray.tsx, and the
-- system message written by pages/api/bookings/create.ts all already try to write and read
-- sender_role on every single message, falling back to a second round-trip without it every
-- time -- because the column does not exist live. This is not a rare edge case: it is the
-- normal path for every message load and send today. Adding the column is purely additive and
-- needs no application change for the primary (non-fallback) path to start working.
--
-- APPLY ORDER: after 20261013_messages_conversations_rls_and_grants.sql, not before. That
-- migration does `revoke all privileges on public.messages from anon, authenticated` before
-- re-granting a fixed column list that does not include sender_role (it was written before this
-- column existed). Applying this migration first would have its grant below wiped out by that
-- later revoke. Applying it after is purely additive on top of that migration's grants, per the
-- same principle documented there.

begin;

alter table public.messages
  add column if not exists sender_role text;

-- Matches the only three values the application ever writes.
alter table public.messages
  add constraint messages_sender_role_check
  check (sender_role is null or sender_role in ('host', 'guest', 'system'));

grant select (sender_role) on public.messages to authenticated;
grant insert (sender_role) on public.messages to authenticated;

commit;
