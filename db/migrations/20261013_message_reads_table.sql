-- Create public.message_reads for real.
--
-- Found during the messaging deep dive: every read and write of message_reads in the app
-- (MessagesPanel.tsx, host/MessagingTray.tsx, both HostShellLayout.tsx/GuestShellLayout.tsx nav
-- unread badges) already assumes this table exists and tolerates it being missing via an
-- isMissingMessageReads()-style check -- because it genuinely does not exist live. The per-
-- conversation unread dot in MessagesPanel.tsx is written correctly against this table; it has
-- simply never had data to read, so it currently shows every conversation as permanently unread.
-- Creating the table is purely additive: no application code needs to change for that dot to
-- start working correctly. (The nav badge's own miscount is a separate bug, fixed in application
-- code alongside this migration -- see lib/useMessagesUnreadCount.ts.)
--
-- RLS is designed in from the start here, unlike bookings/profiles/conversations/messages, which
-- each needed a later remediation migration -- there is no pre-existing broad-access state to
-- correct because the table has never existed. A user may see and write only their own read
-- receipt, and only for a conversation they are actually a participant of; anon gets nothing.
--
-- No ordering dependency on 20261013_messages_conversations_rls_and_grants.sql: this migration's
-- RLS policies below need SELECT on conversations.host_id/guest_id for their own exists() checks,
-- which both the pre-existing (broad) grants and that migration's (narrow) grants already satisfy
-- either way, so apply in whichever order is convenient.

begin;

create table if not exists public.message_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.message_reads enable row level security;

revoke all privileges on public.message_reads from anon, authenticated;

grant select (conversation_id, user_id, last_read_at) on public.message_reads to authenticated;
grant insert (conversation_id, user_id, last_read_at) on public.message_reads to authenticated;
-- UPDATE is needed for the upsert's ON CONFLICT (conversation_id, user_id) DO UPDATE branch
-- (components/MessagesPanel.tsx and components/host/MessagingTray.tsx both upsert on repeat
-- visits to the same conversation) -- only last_read_at is ever actually changed by it.
grant update (last_read_at) on public.message_reads to authenticated;

create policy message_reads_select_own
  on public.message_reads
  for select
  to authenticated
  using (user_id = auth.uid());

create policy message_reads_insert_own
  on public.message_reads
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = message_reads.conversation_id
        and auth.uid() in (c.host_id, c.guest_id)
    )
  );

create policy message_reads_update_own
  on public.message_reads
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE grant/policy for either role -- nothing in the app removes a read receipt; deny by
-- omission, already covered by the revoke above.

commit;
