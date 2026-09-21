-- Payments Phase 2 -- P0-B (Stripe webhook idempotency bookkeeping).
--
-- Tracks per-event processing state so stripe-webhook.ts can distinguish
-- "already fully processed" from "handler never actually completed" --
-- the first cut of this migration (event_id + processed_at only) had a
-- failure mode where a handler crash after the lock row was inserted
-- caused the event to be permanently skipped on every future retry, even
-- though it never succeeded. This revision fixes that with an explicit
-- status column and a state machine enforced by stripe-webhook.ts:
--
--   NEW EVENT       -> INSERT status='processing' (the atomic lock-acquire)
--   HANDLER SUCCESS -> UPDATE status='processed', processed_at=now()
--   HANDLER FAILURE -> DELETE the row (frees the event_id for the next
--                       Stripe retry to atomically reacquire and reprocess)
--
-- 'processing' rows are never left behind by a completed attempt -- a
-- successful delivery always ends in 'processed', a failed delivery always
-- ends in no row at all. The two-value check constraint reflects that only
-- these two states are ever actually persisted.
--
-- Concurrency: two simultaneous deliveries of the same event both attempt
-- INSERT ... ON CONFLICT (event_id) DO NOTHING. Postgres's own
-- unique-constraint enforcement lets exactly one of them win the insert;
-- the other observes zero rows affected and never runs the handler.
--
-- Purely internal bookkeeping -- no application code other than
-- stripe-webhook.ts's service-role client ever needs to touch this table,
-- and nothing here is guest/host-facing data.
--
-- RLS is enabled with zero policies, matching the established deny-all
-- pattern already used for staff_users/audit_log/cases/etc.
-- (db/migrations/20260622_ops_console_schema.sql) -- service-role bypasses
-- RLS entirely, anon/authenticated get no policy to match against. The
-- explicit revoke below is an extra, deliberate step beyond that
-- established pattern, for the same reason documented in the
-- profiles/bookings remediation (Step 3/Step 4, 2026-08-12): Supabase's
-- default privileges on the public schema were found to silently grant
-- anon/authenticated broad access to new tables regardless of what this
-- repo ever explicitly granted, so RLS alone is not evidence that no
-- privilege exists underneath it.
--
-- Rollback (manual):
--   drop table if exists public.processed_stripe_events;

begin;

create table if not exists public.processed_stripe_events (
  event_id text primary key,
  status text not null check (status in ('processing', 'processed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz null
);

alter table public.processed_stripe_events enable row level security;

revoke all privileges on public.processed_stripe_events from anon, authenticated;

commit;
