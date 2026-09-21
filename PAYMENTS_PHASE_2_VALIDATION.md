# Payments Phase 2 — Validation Record

Authoritative record of the Payments Phase 2 work (P0-A through P0-I): Stripe Connect
destination-charge wiring across all four live charge paths, webhook idempotency,
webhook-as-sole-finalizer, and an ops full-refund action. Covers what was implemented,
what was actually tested, and what remains outstanding before this can be considered
launch-ready.

This document reflects only what was directly observed during this audit — via
typecheck/lint output, code review, live Stripe test-mode CLI output captured in
terminal, and explicit statements from the engineer running manual validation. Where
something was not directly observed, it is marked **Pending Validation** rather than
assumed.

---

# P0-A: Host Stripe Readiness Fields

## Objective
Persist enough state per host (`stripe_account_id`, `charges_enabled`, `payouts_enabled`)
to support a pre-charge readiness gate on every payment path, and backfill it for hosts
who connected Stripe before this existed.

## Implementation
- Migration `db/migrations/20260814_profiles_stripe_readiness_fields.sql`: adds
  `profiles.charges_enabled boolean` and `profiles.payouts_enabled boolean`, additive/nullable,
  no client-grant changes (table-level SELECT already covers them; INSERT/UPDATE grants
  are explicit allowlists that don't name them, so only the service-role webhook can write).
- `pages/api/stripe-webhook.ts`'s `account.updated` handler extended to persist
  `stripe_onboarding_status`, `charges_enabled`, and `payouts_enabled` on every event
  (previously only wrote `stripe_onboarding_status` and only when `details_submitted`).
- `lib/hostStripeReadiness.ts`: `getHostStripeReadiness(hostId)` — service-role fetch,
  returns `{ ready, stripeAccountId, chargesEnabled, payoutsEnabled }`.
- `scripts/backfill-host-stripe-readiness.mjs` + `npm run backfill:host-stripe-readiness`:
  one-off script that queries Stripe directly (never infers from `stripe_onboarding_status`)
  for every profile with a `stripe_account_id` and syncs the three fields. Idempotent,
  dry-run supported, logs only ids/booleans (no secrets).

## Validation Performed
- `npm run typecheck` / `npm run lint`: clean at every step.
- Migration applied manually in Supabase by the engineer.
- Backfill script executed against the live (test-mode) connected host.

## Evidence
- Engineer-reported result: **"P0-A is now live and validated. The readiness migration
  was applied successfully and the backfill completed: 1 connected host,
  stripe_onboarding_status = complete, charges_enabled = true, payouts_enabled = true,
  0 failures."**

## Result
**PASS**

## Remaining Risks
- Only one connected host has ever been backfilled/exercised — multi-host behavior
  (e.g. a host with `charges_enabled=true` but `payouts_enabled=false`) has not been
  observed against live data, only against the code path's logic.
- `account.updated` now writes `stripe_onboarding_status:"incomplete"` on the
  `details_submitted=false` branch, a small behavior change from the pre-P0-A code
  (which previously left that field untouched on that branch) — flagged at the time,
  never independently re-verified live since.

---

# P0-B: Webhook Idempotency

## Objective
Guarantee `pages/api/stripe-webhook.ts` processes each Stripe event at most once,
including under Stripe's at-least-once delivery guarantee and concurrent redelivery,
without permanently losing an event that failed mid-processing.

## Implementation
- Migration `db/migrations/20260814_processed_stripe_events.sql`: `processed_stripe_events
  (event_id text primary key, status text check in ('processing','processed'), created_at,
  processed_at)`. RLS enabled, zero policies, explicit `revoke all` from `anon`/`authenticated`
  (defense-in-depth beyond the deny-by-RLS pattern, per the profiles/bookings precedent).
- Lock acquisition: `INSERT ... ON CONFLICT (event_id) DO NOTHING` via
  `upsert(ignoreDuplicates: true)` — one atomic statement, immediately after signature
  verification, before any event-type handling.
- On conflict (event already locked/processed): a read-only status check decides the
  response — `processed` → `200 duplicate`; `processing` (or the row vanished, e.g. a
  reset-after-failure) → `409`, no reprocessing either way.
- On handler success: bounded retry (3 attempts) to flip the row to `processed`,
  verified by requiring exactly one row returned from the UPDATE (not just `error===null`,
  since PostgREST doesn't return matched rows from an UPDATE by default) — a earlier
  version of this check was corrected mid-review for exactly this gap.
- On handler failure: the `processing` row is deleted, freeing the `event_id` for a
  future Stripe retry to atomically reacquire and reprocess. If all 3 mark-processed
  attempts fail after a successful handler run, the row is deliberately **not** deleted
  (side effects already happened once; freeing the lock could double-run them) — this
  is logged as a stuck state requiring manual cleanup, not auto-recovered.

## Validation Performed
- `npm run typecheck` / `npm run lint`: clean at every step, across four correction rounds.
- Migration applied manually in Supabase by the engineer.
- Live test-mode duplicate-delivery test (P0-I Test B): the Stripe CLI's
  `stripe events resend` was used to redeliver the **same** `event.id` (not a new one, unlike
  `stripe trigger`) to a local `stripe listen` session forwarding to
  `http://localhost:3000/api/stripe-webhook`.

## Evidence
- Prior to the resend, the engineer confirmed via direct Supabase query that
  `processed_stripe_events` already contained `evt_1U4LiDLwZXIfOxbIekA59bhh` with
  `status='processed'` from the original delivery.
- Terminal output from the `stripe listen` session, captured directly:
  ```
  2026-08-15 13:25:10   --> checkout.session.completed [evt_1U4LiDLwZXIfOxbIekA59bhh]
  2026-08-15 13:25:11  <--  [200] POST http://localhost:3000/api/stripe-webhook [evt_1U4LiDLwZXIfOxbIekA59bhh]
  ```
- Next.js dev server log: `POST /api/stripe-webhook 200 in 441ms`.
- The resend request's own response body confirmed the redelivered event carried the
  identical `id` (`evt_1U4LiDLwZXIfOxbIekA59bhh`) and the original booking metadata.

## Result
**PARTIAL** — the transport-level behavior (same event ID redelivered, endpoint returns
`200`, no error) is directly confirmed. What is **not** independently confirmed:
- The exact response body (`{ duplicate: true }`) was not captured/inspected.
- Because this event was already `status='processed'` *before* the P0-I webhook-payload
  fix was made, the resend was intercepted by the idempotency check before ever reaching
  the `switch` — meaning **the fixed finalization payload logic was never actually
  re-executed by this test**. It validates idempotency short-circuiting correctly; it does
  not validate the P0-G/P0-I finalization fix.
- No independent Supabase check was performed after the resend to confirm the booking
  row, `booking_notes`, or email-send count were unaffected by the duplicate delivery.

## Remaining Risks
- **Pending Validation**: confirm via Supabase that the duplicate delivery caused no
  second booking mutation and no second confirmation email.
- ~~Run idempotency against a genuinely *new* event processed by the post-fix code~~ —
  **closed by P0-G's post-fix re-test**: a fresh booking's `checkout.session.completed`
  event was processed by the post-fix code and `processed_stripe_events` idempotency was
  reconfirmed as part of that test (engineer-reported, see P0-G). The mark-processed
  retry path specifically (as opposed to the duplicate-rejection path this section's own
  CLI test exercised) was not separately isolated, but the post-fix code path as a whole
  is no longer unexercised.
- The "all 3 mark-processed attempts fail" stuck-state path (row stays `processing`
  forever, requiring manual cleanup) has never been exercised live — only reasoned about.

---

# P0-C: Stripe Connect on `bookings/create.ts`

## Objective
Wire real Stripe Connect destination-charge fee-splitting into the primary
nightly-booking path, gated on host readiness, with a stable idempotency key.

## Implementation
- `getHostStripeReadiness()` gate — moved, after a correction, to run **before** the
  `bookings` row insert (the original placement was post-insert, which risked leaving a
  phantom `awaiting_payment` row blocking `bookings.no_overlap` if the host turned out
  not to be ready).
- `application_fee_amount = guest_total_pence - host_net_total_pence`, both read back
  from the persisted booking row (not recomputed), validated integer/`>=0`/`<= guest_total_pence`
  before the Stripe call.
- `payment_intent_data: { application_fee_amount, transfer_data: { destination } }` added
  to the existing `stripe.checkout.sessions.create()` call; `on_behalf_of` omitted per
  product decision (platform remains merchant of record for the Stansted-first UK MVP).
- Idempotency key `booking-create-${bookingRow.id}` as the second argument to
  `stripe.checkout.sessions.create()`.

## Validation Performed
- `npm run typecheck` / `npm run lint`: clean at every step, across two rounds
  (initial implementation, then the pre-insert gate-placement correction).
- Live test-mode booking created through the real guest-facing flow (P0-I Test A):
  listing booked, Checkout completed with a test card.

## Evidence
- Directly observed via the Stripe CLI resend of this booking's `checkout.session.completed`
  event: `amount_total: 10500` (GBP, £105.00), `currency: "gbp"`, `payment_status: "paid"`,
  `status: "complete"`, `payment_intent: "pi_3U4LiALwZXIfOxbI1EyBwcbP"`,
  `metadata: { booking_id: "ff94c5a0-2730-4d03-a734-7bfc0e27769d", host_id:
  "69fe21af-4cbb-4944-905c-74c0c4ae5c7d", guest_id: "092f338b-dffe-49fe-a827-2110302c66a9",
  listing_id: "3955c66f-7c01-43ce-8856-5b753397c84e" }`.
- The engineer separately reported the resulting `bookings` row after webhook processing:
  `status = paid`, `stripe_status = succeeded`, `payout_status = awaiting_payout`,
  `stripe_checkout_session_id` populated, **`stripe_payment_intent_id = NULL`** — this is
  the P0-G finalization bug (see below), not a Connect-wiring defect.

## Result
**PARTIAL** — a real Checkout Session was created and paid successfully, and the guest
was charged the correct all-inclusive total. What is confirmed: the session was created
without error, using the Connect-shaped `payment_intent_data`. What is **not** confirmed
from anything reported back in this audit:
- Whether the PaymentIntent's actual `application_fee_amount` and
  `transfer_data.destination` matched the expected values, as observed directly in the
  Stripe Dashboard (the Checkout Session JSON captured via CLI does not expose
  PaymentIntent-level `application_fee_amount`/`transfer_data` fields).
- Whether the connected test host's balance actually received the expected transfer.
- The finalization bug (missing `stripe_payment_intent_id`, wrong `status`) was found and
  fixed under P0-G/P0-I, but this same booking has not been re-checked to confirm the fix
  actually landed on it (it was written by the *pre-fix* code).

## Remaining Risks
- **Pending Validation**: confirm `application_fee_amount`/`transfer_data.destination`
  directly in the Stripe Dashboard for this or a fresh booking — still not reported by
  anything observed in this audit.
- **Pending Validation**: confirm the connected host's balance reflects the expected net
  transfer.
- ~~Re-check `stripe_payment_intent_id` persistence~~ — **closed by P0-G's post-fix
  re-test**: a fresh standard booking run through the fixed webhook code was reported to
  have `stripe_payment_intent_id` persist correctly (engineer-reported, see P0-G). This
  specifically confirms the P0-C code path's interaction with the P0-G fix works; it does
  not by itself confirm the Connect fee-split/transfer amounts, which remain open above.

---

# P0-D: Stripe Connect on `shared-groups/checkout.ts`

## Objective
Apply the same Connect pattern to shared/crew-stay checkout, without recomputing the
guest-facing charge and without assuming a host-net figure that didn't already exist in
this flow.

## Implementation
- Investigation first: found the shared-checkout flow persisted a guest charge
  (`amountPence`) but had **no** host-net or platform-fee concept anywhere — reported
  this and stopped rather than inventing a calculation.
- Per product decision (`shared_weekly_price_pence` treated as already all-inclusive,
  guest charge unchanged): host net derived as
  `amountPence - min(floor(amountPence × platformFeeBps / 10000), PLATFORM_FEE_CAP_PENCE)`,
  using `getPlatformFeeBps()`/`PLATFORM_FEE_CAP_PENCE` already centralized in
  `lib/pricing.ts` (mirroring, not duplicating, the standard path's fee formula).
- Readiness gate moved to run before the `shared_group_members` "pending" reservation
  is created/reused (a pending hold already counts toward group occupancy, same
  phantom-blocking concern as P0-C).
- `application_fee_amount`/`transfer_data.destination` added to the per-member Checkout
  Session; idempotency key `shared-checkout-${sharedGroupMemberId}`.
- `host_net_total_pence`/`platform_fee_bps` persisted on the provisional booking row
  (confirmed-live columns); `pricing_version`/`stripe_var_bps`/`stripe_fixed_pence`
  deliberately left unpopulated after a follow-up check confirmed they'd misrepresent
  a computation this flow doesn't actually perform.

## Validation Performed
`npm run typecheck` / `npm run lint`: clean at every step, across the investigation
round and the implementation round.

## Evidence
None — no live shared-group checkout has been executed in this audit.

## Result
**Not yet tested — Pending Validation.**

## Remaining Risks
- Entire shared-group Connect path is implemented and code-reviewed but has zero live
  test-mode evidence. No shared-stay-enabled listing has been confirmed to exist in the
  current test data.

---

# P0-E: Stripe Connect on `flex/confirm.ts` (flex extra night)

## Objective
Apply the same Connect pattern to the flex-extra-night incremental charge, reusing the
booking's own existing `platform_fee_bps` rather than a fresh calculation.

## Implementation
- `host_id`/`platform_fee_bps` added to all four schema-drift-tolerant `bookingSelects`
  variants (previously not selected by this route at all).
- Readiness gate placed after the charge-amount validation, before the prior-PaymentIntent
  `retrieve()` call — fails fast, though this route has no phantom-row risk (nothing
  payable is created before the charge; `flex_extra_night_status` only flips at the end).
- `application_fee_amount = min(floor(chargeAmountPence × platformFeeBps / 10000), PLATFORM_FEE_CAP_PENCE)`,
  using the booking's own stored `platform_fee_bps` (a follow-up consistency check
  confirmed the fee cap is applied per-charge, not booking-wide — no cross-charge
  aggregate cap exists anywhere in the pricing model).
- `application_fee_amount`/`transfer_data.destination` added directly to
  `stripe.paymentIntents.create()`; idempotency key `flex-confirm-${booking.id}`
  (sufficient since this feature permits at most one successful charge per booking).

## Validation Performed
`npm run typecheck` / `npm run lint`: clean. A separate consistency review confirmed the
fee-cap semantics (per-charge, not booking-wide) against `lib/pricing.ts`'s actual code.

## Evidence
None — no live flex-extra-night confirmation has been executed in this audit.

## Result
**Not yet tested — Pending Validation.**

## Remaining Risks
- No flex-extra-night-reserved test booking has been confirmed to exist; staging one
  requires a real same-day-checkout test booking (fabricating a DB row would fail at the
  `stripe.paymentIntents.retrieve()` call, since a synthetic PaymentIntent ID wouldn't
  exist in Stripe).

---

# P0-F: Stripe Connect on `flex/extend.ts` (rolling flex extension)

## Objective
Apply the same Connect pattern to rolling-flex extension charges.

## Implementation
- Same `host_id`/`platform_fee_bps` addition to `bookingSelects`.
- Gate, fee derivation, and Connect wiring scoped inside the existing
  `if (extensionAmountPence > 0)` block — when an extension needs no new charge, no
  gate/Stripe call happens at all.
- Idempotency key `flex-extend-${heldWindow.id}` — the `booking_flex_windows` row already
  used as this route's own durable per-extension-event identifier in its existing
  metadata, confirmed to be confirmable only once (`.eq("status","held")` guard).

## Validation Performed
`npm run typecheck` / `npm run lint`: clean.

## Evidence
None — no live rolling-flex extension has been executed in this audit.

## Result
**Not yet tested — Pending Validation.**

## Remaining Risks
- Same staging constraint as P0-E: requires a real rolling-flex test booking with a
  held extension window before its cutoff; cannot be fabricated via direct DB insert.

---

# P0-G: Webhook as Sole Finalization Authority

## Objective
Make `stripe-webhook.ts`'s `checkout.session.completed` handler the only writer of
booking finalization state and the only sender of confirmation email; make
`confirm-session.ts` strictly read-only.

## Implementation
- `pages/api/stripe/confirm-session.ts` rewritten: removed the shared-group finalization
  call, the standard-booking finalization `UPDATE` (and its `paidFallback` retry), and
  every `sendBookingEmails` call. Added authentication (`createPagesServerClient`) and an
  ownership check against the Stripe session's own `guest_id` metadata — the original
  route had **no** auth/ownership check at all, so this is a strengthening, not just a
  preservation, of the endpoint's security. New response contract:
  `{ status: "finalized" | "pending", bookingId, stripePaid }`, always derived from the
  booking's own DB state, never from the raw Stripe session status.
- `pages/booking/success.tsx`'s poll loop adapted to the new contract; patience increased
  from 3 attempts × 500ms to 6 attempts × 1000ms (~15s worst case, from ~3s) since the
  webhook is now a genuinely asynchronous, separate delivery rather than something the
  same request used to trigger synchronously.
- **Bug found via P0-I Test A and fixed here**: traced the reported bug (`status=paid`
  instead of `confirmed`, `stripe_payment_intent_id=NULL`) to the live
  `bookings_status_check`/`bookings_status_chk` constraints, confirmed by the engineer to
  allow `pending/awaiting_payment/approved/paid/declined/cancelled` — **not** `confirmed`.
  Every update attempting `status:"confirmed"` was guaranteed to fail, degrading through a
  3-tier fallback whose final tier (`paidFallback`) was built from a stripped payload that
  never included the Stripe identifiers. Fixed by making `"paid"` the canonical status
  throughout, and ensuring every remaining fallback tier always carries
  `stripe_checkout_session_id`/`stripe_payment_intent_id`. Verified `isFinalizedBookingState()`
  in `confirm-session.ts` and `isPaidFinalBookingStatus()` in `lib/bookingStatus.ts` already
  treated `"paid"` as fully final, so no other file needed to change.
- A full-repository grep for every `"confirmed"` occurrence was performed afterward to
  check for other code assuming the old value; documented separately (see below) — no
  other live bug found, only two stale/cosmetic items.

## Validation Performed
- `npm run typecheck` / `npm run lint`: clean at every step, across the full rewrite,
  the bug diagnosis, and the fix.
- Full-repo grep audit of all 41 `"confirmed"` occurrences, each traced to its target
  table/context.
- The bug itself was caught by live test-mode validation (P0-I Test A), not by code
  review — a genuine finding, not a synthetic test.
- A fresh standard test-mode booking was run end-to-end through Checkout →
  `checkout.session.completed` webhook processing, post-fix, to directly confirm the fix
  (engineer-reported).

## Evidence
- The engineer's live-constraint query result confirming the actual allowed values of
  `bookings_status_check`/`bookings_status_chk` (`confirmed` absent).
- The booking row state reported after the original (pre-fix) `checkout.session.completed`
  processing, matching the diagnosed degradation path exactly.
- Repo-wide grep confirmed: no `.eq("status", "confirmed")` exact-match query exists
  anywhere (the highest-risk pattern); every `bookings.status` comparison site already
  treats `"paid"`/`"confirmed"` as equivalent or was unrelated (different table
  entirely — `shared_group_members`, `shared_groups`, `booking_flex_windows`).
  `lib/sharedCheckout.ts` (shared-group finalization, writes to the same `bookings`
  table) was independently confirmed to already write `"paid"`, never `"confirmed"` —
  it was not affected by this bug.
- **Engineer-reported, post-fix re-test**: on a fresh standard booking, the webhook
  finalized correctly — booking ended in `status = paid`, and `stripe_payment_intent_id`
  persisted (the exact field the pre-fix code left `NULL`). `processed_stripe_events`
  idempotency was reconfirmed as part of this same test.
- No specific booking ID, Stripe Dashboard screenshot, or raw Supabase query output was
  provided alongside this report — the above is recorded as the engineer's stated result,
  not independently re-verified by inspecting Stripe/Supabase directly.

## Result
**PASS** — the finalization-payload fix is now confirmed against a fresh live event, not
just reasoned about: `status = paid` and `stripe_payment_intent_id` both persist
correctly post-fix, per the engineer's report above. `confirm-session.ts`'s new
read-only/ownership-check behavior was exercised as part of the same end-to-end flow
(the booking reached `status:"finalized"` for the success page to observe), though the
specific negative case (a mismatched user being rejected) was not separately reported and
remains unverified.

## Remaining Risks
- **Pending Validation**: confirm `confirm-session.ts`'s new ownership check correctly
  rejects a mismatched user (never explicitly tested — only the successful/matching-owner
  path was exercised).
- **Pending Validation**: direct Stripe Dashboard confirmation of this fresh booking's
  `application_fee_amount`/`transfer_data.destination` was not part of what was reported —
  see P0-C.
- Two stale-but-harmless items found during the repo-wide grep, not fixed (out of scope,
  reported for awareness): `pages/api/bookings/[id].ts`'s `normalizeBookingStatus` still
  manufactures a display-only `"confirmed"` value in one narrow edge case; the ops
  bookings list filter labels `"paid"` as `"(legacy)"`, which is now backwards.

---

# P0-H: Ops Full-Refund Flow

## Objective
Replace the manual "refund in Stripe Dashboard" instruction with a safe, idempotent,
audited ops action for destination-charge refunds.

## Implementation
- `pages/api/ops/bookings/[id]/refund.ts` (new): `requireOpsStaffApi` +
  `ops:bookings:write`, reuses `isPaidFinalBookingStatus()` as the refundable-state check
  (no new status policy invented).
- `stripe.refunds.create({ payment_intent, reverse_transfer: true, refund_application_fee: true },
  { idempotencyKey: "ops-refund-${booking.id}" })` — verified compatible with the installed
  SDK (`stripe@19.3.1`) via its type definitions before implementing.
- `charge_already_refunded` errors are treated as a reconciliation case (look up the
  existing refund via `stripe.refunds.list`, continue the same DB sequence) rather than a
  hard failure — makes retries safe without risking a duplicate refund.
- **Write ordering corrected mid-review**: originally wrote `bookings.status='cancelled'`
  before the `booking_notes` audit entry; if the note insert then failed, the booking
  would be stuck outside the refundable-status gate with no audit trail and no safe retry
  path. Reordered so the note (existence-checked first, to make retries idempotent) is
  written before the status flip — status only ever becomes `cancelled` once the audit
  record is confirmed to exist.
- `pages/ops/bookings/[id].tsx`: manual-refund instructions replaced with a **Full Refund**
  button (confirmation prompt, disabled/loading state, success feedback, page reload),
  only rendered when the booking is actually refundable.

## Validation Performed
- `npm run typecheck` / `npm run lint`: clean across all three implementation rounds
  (initial build, write-ordering fix, follow-up review).
- Live test-mode full refund executed via the ops UI (`Full Refund` button on
  `pages/ops/bookings/[id].tsx`) against a real `status:"paid"` test booking
  (engineer-reported).

## Evidence
**Engineer-reported, live test-mode refund:**
- Full refund completed successfully; a Stripe refund was created for the booking's
  PaymentIntent.
- `bookings.status` changed to `cancelled`.
- A `booking_notes` entry was created containing the Stripe refund ID.
- An `audit_log` entry was created with `action = "booking_refunded"`.
- After cancellation, the Full Refund button was no longer available on the booking
  (matching `canRefund`'s client-side check and the server-side `isPaidFinalBookingStatus`
  gate both correctly excluding a `cancelled` booking).

No specific Stripe refund ID, booking ID, refund amount, Stripe Dashboard screenshot, or
raw Supabase query output was provided alongside this report — the above is recorded as
the engineer's stated result, not independently re-verified by inspecting Stripe/Supabase
directly.

## Result
**PASS** — a live test-mode refund completed the full intended sequence: Stripe refund
created, booking cancelled, audit note with refund ID recorded, audit log entry recorded,
and the refund action correctly made unavailable afterward.

## Remaining Risks
- **Pending Validation**: direct Stripe Dashboard confirmation that `reverse_transfer`
  actually reversed the connected account's transferred balance and
  `refund_application_fee` actually returned the platform's fee — the report confirms a
  refund object was created, not the specific balance-level effects on the connected
  account.
- **Pending Validation**: the `charge_already_refunded` reconciliation path (a second
  refund attempt hitting Stripe directly, e.g. via a retried request after a DB-write
  failure) has still not been exercised — only the straightforward single-refund path and
  the client-side re-attempt prevention (button hidden) were confirmed.
- **Pending Validation**: partial-refund behavior remains unbuilt/untested by design (MVP
  is full-refund only) — no change from prior status.

---

# P0-I: Test-Mode Validation

## Objective
Prepare and execute controlled Stripe test-mode validation of P0-A through P0-H before
considering Payments Phase 2 launch-ready, without touching architecture further.

## Implementation
N/A — validation phase, no application code changes originated here (the P0-G
finalization-payload fix was implemented as a direct consequence of a bug this phase
found, documented under P0-G above).

## Validation Performed
- Full sanity-check pass across every file touched in P0-A–H: fresh `npm run typecheck`
  and `npm run lint` (clean), plus a manual scan for duplicate declarations, stale
  imports, dead variables, and partially-applied edits (none found).
- Confirmed via engineer statement that both required migrations were applied live
  (`profiles.charges_enabled`/`payouts_enabled`, `processed_stripe_events`).
- Produced a full test-mode validation checklist for all six flows (standard booking,
  webhook idempotency, shared group, flex extra night, flex extend, ops refund) with
  exact UI actions, Stripe Dashboard checks, Supabase queries, and stop-launch conditions.
- **Test A (standard booking)**: executed live — found the P0-G finalization bug (see
  above), which was diagnosed and fixed within this phase.
- **Test B (webhook idempotency)**: executed live — set up a local Stripe CLI listener
  bound to the app's actual sandbox key (not the CLI's default profile, which pointed at
  a different account), captured the generated webhook signing secret without exposing
  it, updated `.env.local`, restarted the dev server, and used `stripe events resend` to
  redeliver the exact original event ID. Confirmed at the transport level (see P0-B).
- **Test A, re-run post-fix**: executed live (engineer-reported) — a fresh standard
  booking finalized correctly under the fixed webhook code (see P0-G).
- **Test F (ops full refund)**: executed live (engineer-reported) — see P0-H.
- **Tests C, D, E**: not yet executed. Exact manual procedures (UI paths, Stripe/Supabase
  checks, expected results, and staging steps for missing test data) were prepared but
  not run.

## Evidence
See P0-A through P0-H above for the evidence gathered under each corresponding milestone.

One incidental issue during Test B setup: a process-inspection command
(`ps -o command`) briefly printed the full Stripe secret key value (including the
`--api-key` CLI argument) into a tool-call result during this session. This was
flagged to the engineer immediately; no other secret exposure occurred; the value was
never repeated afterward.

## Result
**PARTIAL** — the validation *process* itself (sanity check, checklist, tooling setup)
is complete and sound. Of the six flows the checklist covers: standard booking surfaced
and fixed a real bug, then was re-confirmed post-fix; ops full refund is confirmed
end-to-end; webhook idempotency is confirmed at the transport level plus reconfirmed as
part of the post-fix standard-booking re-test. Three flows (shared group, flex extra
night, flex extend) have not been executed at all.

## Remaining Risks
See "Remaining Manual Validation" below.

---

# Overall Payments Phase 2 Status

## Completed
- **P0-A** — Host Stripe readiness fields: implemented, migrated live, backfilled,
  confirmed by the engineer. **PASS.**
- **P0-B** — Webhook idempotency: implemented, migrated live, transport-level duplicate
  delivery confirmed, and reconfirmed as part of the P0-G post-fix re-test. DB-level
  non-duplication of the original CLI resend test specifically (no second booking
  mutation/email from *that* test) remains unconfirmed. **PARTIAL.**
- **P0-C** — Connect on standard bookings: implemented; a real charge succeeded and,
  per the P0-G post-fix re-test, `stripe_payment_intent_id` now persists correctly.
  Fee-split/transfer amount correctness still never independently confirmed in Stripe
  Dashboard. **PARTIAL.**
- **P0-D** — Connect on shared-group checkout: implemented, code-reviewed, no live test.
  **Pending Validation.**
- **P0-E** — Connect on flex extra night: implemented, code-reviewed, no live test.
  **Pending Validation.**
- **P0-F** — Connect on flex extend: implemented, code-reviewed, no live test.
  **Pending Validation.**
- **P0-G** — Webhook sole-finalizer redesign + the status/payment-intent-id bug fix:
  implemented, typecheck/lint clean, repo-wide grep audit found no other live-breaking
  occurrence of the old assumption, and confirmed against a fresh live event
  (engineer-reported): `status = paid`, `stripe_payment_intent_id` persists,
  `processed_stripe_events` idempotency reconfirmed. **PASS.**
- **P0-H** — Ops full-refund flow: implemented, code-reviewed, and confirmed via a live
  test-mode refund (engineer-reported): Stripe refund created, booking cancelled, audit
  note with refund ID recorded, audit log entry recorded, refund action unavailable
  afterward. **PASS.**
- **P0-I** — Validation preparation and execution: sanity check complete, checklist
  complete, four of six flows now executed (standard booking, idempotency, ops refund
  confirmed; three flows still pending — see below). **PARTIAL.**
- **Ops console hydration fixes** (raised during this phase, not part of the original
  P0-A–I scope): every `Intl.DateTimeFormat`/`toLocaleString`/`toLocaleDateString` call
  under `pages/ops/**` refactored to a single shared deterministic formatter
  (`lib/opsDateFormat.ts`) that avoids both known classes of ICU-version-dependent SSR/
  hydration mismatch (date+time glue-pattern text, and locale month-name drift).
  `npm run typecheck`/`npm run lint` clean; no remaining risky date-formatting pattern
  found anywhere under `pages/ops/**` on re-scan. **PASS.**

## Remaining Manual Validation
- Shared-group checkout (P0-D) — **Pending Validation**
- Flex extra night (P0-E) — **Pending Validation**
- Rolling flex extension (P0-F) — **Pending Validation**
- Direct Stripe Dashboard confirmation of `application_fee_amount`/`transfer_data.destination`
  and connected-account balance effects, for both the standard-booking charge (P0-C) and
  the full-refund reversal (P0-H) — reported outcomes confirm the *objects were created
  correctly*, not the specific balance-level Stripe amounts, since no Dashboard figures
  were part of what was reported — **Pending Validation**
- Confirmation that the original P0-B CLI duplicate-delivery test caused no DB-level side
  effect (booking, notes, email) — **Pending Validation** (distinct from the idempotency
  reconfirmation that did happen during the P0-G post-fix re-test)
- `confirm-session.ts`'s ownership check specifically rejecting a mismatched user —
  **Pending Validation**
- The `charge_already_refunded` reconciliation path in the refund endpoint — **Pending
  Validation**

## Launch Blockers
No genuine production blocker is currently known. The one previously-open blocker — the
P0-G finalization bug — is now resolved and confirmed against a fresh live event, not
just implemented.

**Three of the original six P0-I flows still have zero live evidence** (shared group,
flex extra night, flex extend). Given how P0-C's real-world testing caught a bug that
code review alone missed, none of these three should be treated as launch-ready purely
on the strength of clean typecheck/lint and code review — this is a real launch
consideration, not a formality, but it is a verification gap, not a known defect.

Everything else in this document marked "Pending Validation" is an open verification
task, not a known defect.

## Recommended Next Phase
Before any real-money launch: close out the "Remaining Manual Validation" list above —
this is execution of the already-prepared P0-I test plan for the three still-untested
flows (shared group, flex extra night, flex extend), plus the direct Stripe Dashboard
amount checks for the two flows already confirmed structurally correct. None of this is
new design work. Once all six flows are confirmed with real Stripe Dashboard + Supabase
evidence (not just code review), the natural next phase is the P1 tier from the original
production-readiness
audit: RLS for `reviews`/`booking_flex_windows`/`shared_groups`/`shared_group_members`
(still flagged as never having RLS enabled at all), the minimal ops "suspend listing"
capability, and basic rate limiting on `bookings/create.ts` and the verification
endpoints — all previously scoped, none touched during Payments Phase 2.
