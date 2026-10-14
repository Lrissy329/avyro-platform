-- Messaging security remediation: lock down public.conversations and public.messages.
--
-- Found during an unrelated read-only audit: the anon (public) key could read every
-- row of both tables in full -- every message body, every conversation's host/guest
-- pairing -- with no session at all. Applies the same model already used for
-- public.bookings (see 20260812_bookings_rls_and_grants.sql): REVOKE ALL first (grants
-- are additive and checked independently of RLS, so a stray broad grant survives any
-- policy), then narrow column grants + policies restricted to the two participants.
--
-- Differs from the bookings migration in two ways, both load-bearing:
--
--   1. This repo's migration history never created these two tables (they are
--      live-only, like several other tables flagged earlier in this engagement), so
--      the exact names of whatever policies exist today were not known ahead of
--      writing this migration (no SQL-execution path was available to inspect
--      pg_policies from outside a migration). Rather than hardcode guessed names, the
--      DO block below drops every existing policy on these two tables by reading
--      pg_policies at run time. This matters because Postgres policies for the same
--      command are OR'd together (permissive by default) -- leaving even one old
--      permissive policy in place would silently keep the table wide open underneath
--      the new narrow policy.
--
--   2. The app writes to public.conversations with upsert(..., { onConflict:
--      "booking_id" }) (components/MessagesPanel.tsx, components/BookingWidget.tsx),
--      which Postgres executes as INSERT ... ON CONFLICT (booking_id) DO UPDATE SET
--      host_id = excluded.host_id, guest_id = excluded.guest_id (every submitted
--      column besides the conflict target). So the conflict branch needs an UPDATE
--      grant/policy covering host_id and guest_id too, not just last_message_at --
--      otherwise every re-upsert of an existing conversation (the common case) would
--      fail. Both the INSERT and UPDATE policies below carry the same check so this
--      doesn't reopen the hole: the submitted host_id/guest_id must equal the real
--      bookings row for that booking_id, and the caller must be one of those two
--      people. A no-op re-upsert of the same values by the same participant passes;
--      impersonating the other party or attaching a conversation to someone else's
--      booking does not.
--
-- Confirmed write/read call sites this migration must keep working (all client-side,
-- "authenticated" role, found by reading every from("conversations")/from("messages")
-- call under components/ and pages/):
--   - components/MessagesPanel.tsx: load conversations (select, own rows), create a
--     conversation from a booking id (upsert/insert, either party), load/send messages
--     (select/insert, sender_id = self), update last_message_at after sending.
--   - components/host/MessagingTray.tsx: same message load/send/update pattern, host
--     side.
--   - components/BookingWidget.tsx: guest-side conversation upsert right before
--     Stripe Checkout redirect.
--   - pages/api/bookings/create.ts and pages/api/messages/participant-profile.ts both
--     use the service-role client (lib/supabaseServer.ts) and so bypass RLS entirely;
--     unaffected either way.
--   - messages.sender_role does not exist in the live schema (the app already
--     tolerates this with a fallback insert), so it is not part of any grant here --
--     granting a privilege on a nonexistent column is not valid SQL regardless.
--   - public.message_reads does not exist live either (a separate, already-tolerated
--     schema-drift gap); untouched by this migration.
--
-- Rollback (manual; re-opens the hole this closes -- last resort, not routine):
--   drop policy if exists conversations_select_own on public.conversations;
--   drop policy if exists conversations_insert_own on public.conversations;
--   drop policy if exists conversations_update_own on public.conversations;
--   drop policy if exists messages_select_own on public.messages;
--   drop policy if exists messages_insert_own on public.messages;
--   grant all privileges on public.conversations, public.messages to anon, authenticated;

begin;

-- 1. RLS must be ON for any policy below to matter. Idempotent if already enabled.
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- 2. Revoke ALL existing privileges from both roles first, for the same
-- additive-privilege reason as the bookings/profiles migrations: a narrower grant
-- added afterward does not revoke a broader grant already in place, and anon gets no
-- base-table access of any kind, on either table.
revoke all privileges on public.conversations from anon, authenticated;
revoke all privileges on public.messages from anon, authenticated;

-- 3. Drop every existing policy on both tables, whatever it is named today -- see
-- the note above on why this can't be a handful of hardcoded "drop policy if exists"
-- lines the way the bookings migration did it.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'conversations'
  loop
    execute format('drop policy if exists %I on public.conversations', pol.policyname);
  end loop;

  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'messages'
  loop
    execute format('drop policy if exists %I on public.messages', pol.policyname);
  end loop;
end
$$;

-- 4. conversations: SELECT -- either party reads their own thread's metadata.
grant select (id, booking_id, host_id, guest_id, last_message_at, created_at, updated_at)
  on public.conversations to authenticated;

create policy conversations_select_own
  on public.conversations
  for select
  to authenticated
  using (auth.uid() in (host_id, guest_id));

-- 5. conversations: INSERT and UPDATE (host_id, guest_id, last_message_at) share one
-- check -- see note 2 above for why UPDATE must cover host_id/guest_id, not just
-- last_message_at. The check ties the row to a real booking rather than trusting the
-- client-supplied host_id/guest_id on their own: the caller must be one of the two
-- people on that booking, and the host_id/guest_id being written must equal that
-- booking's actual host_id/guest_id (so a participant can file a no-op re-upsert of
-- the same values, but can't repoint the row at a different booking or swap in a
-- different counterparty).
grant insert (booking_id, host_id, guest_id)
  on public.conversations to authenticated;
grant update (host_id, guest_id, last_message_at)
  on public.conversations to authenticated;

create policy conversations_insert_own
  on public.conversations
  for insert
  to authenticated
  with check (
    auth.uid() in (host_id, guest_id)
    and exists (
      select 1 from public.bookings b
      where b.id = conversations.booking_id
        and b.host_id = conversations.host_id
        and b.guest_id = conversations.guest_id
    )
  );

create policy conversations_update_own
  on public.conversations
  for update
  to authenticated
  using (auth.uid() in (host_id, guest_id))
  with check (
    auth.uid() in (host_id, guest_id)
    and exists (
      select 1 from public.bookings b
      where b.id = conversations.booking_id
        and b.host_id = conversations.host_id
        and b.guest_id = conversations.guest_id
    )
  );

-- 6. conversations: no DELETE grant/policy for either role -- deny by omission,
-- already covered by step 2's revoke.

-- 7. messages: SELECT -- either party on the parent conversation reads its messages.
-- The exists() re-queries conversations under that table's own new RLS (step 4), so
-- this is restricted to participants twice over, not just once.
grant select (id, conversation_id, sender_id, body, created_at)
  on public.messages to authenticated;

create policy messages_select_own
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and auth.uid() in (c.host_id, c.guest_id)
    )
  );

-- 8. messages: INSERT only -- a sender can only post as themselves, into a
-- conversation they are actually part of. No UPDATE/DELETE grant for either role:
-- nothing in the app edits or removes a sent message.
grant insert (conversation_id, sender_id, body)
  on public.messages to authenticated;

create policy messages_insert_own
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and auth.uid() in (c.host_id, c.guest_id)
    )
  );

commit;
