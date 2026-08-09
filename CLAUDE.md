# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Aeronooc/Flexivo is a Next.js 14 (Pages Router) short-term rental / crew-housing marketplace. Guests book listings from hosts with support for nightly, day-use, split-rest, crashpad, flexible ("rolling flex"), and shared/crew stays. There's a staff-facing "ops console" for support, sales, and verification workflows, plus Stripe Connect for host payouts.

## Product Vision

This platform is built specifically for aviation professionals who need short-notice, flexible-duration housing near airports and bases: pilots, cabin crew, engineers, airport staff, and aviation students. Stay types like `crashpad`, `split_rest`, and "rolling flex" checkout windows exist because of this audience's scheduling patterns (irregular rosters, layovers, short-notice changes) — they are not generic vacation-rental features, so don't simplify them toward a generic Airbnb model without checking whether the aviation use case still needs the nuance.

Long-term direction is to expand into other mobile professional sectors (e.g. rail crew, maritime, touring/event crew) once the aviation-specific model is proven — keep that in mind when deciding whether something should be aviation-specific or written more generically, but don't build generic abstractions speculatively ahead of an actual second vertical (see Engineering Principles below).

## Commands

```bash
npm run dev            # start dev server
npm run dev:clean      # wipe .next and start dev server (use after weird HMR/build errors)
npm run build           # production build
npm run start           # run production build
npm run typecheck       # tsc --noEmit (no test suite exists — this + lint are the CI-equivalent checks)
npm run lint            # next lint (eslint-config-next)
npm run smoke:rolling-flex   # standalone Node script hitting Supabase directly to smoke-test rolling flex booking creation; reads .env.local
```

There is no test framework (no jest/vitest/playwright) — `typecheck` and `lint` are the only automated checks. Always run both after non-trivial changes.

Database migrations live in `db/migrations/*.sql`, named `YYYYMMDD_description.sql`, applied manually against Supabase (no migration runner in this repo — check how the team applies these before assuming `npm run migrate` or similar exists).

## Architecture

**Stack**: Next.js Pages Router + TypeScript, Supabase (Postgres + Auth), Stripe (Connect + Checkout), Tailwind + shadcn/ui (`components.json`, style "new-york"), Framer Motion, react-map-gl/Mapbox for maps, DayPilot for some calendar views.

**Path alias**: `@/*` maps to repo root (see `tsconfig.json`).

### Supabase client boundaries

Three distinct Supabase entry points — using the wrong one is a common bug source:

- `lib/supabaseClient.ts` — anon-key client. Browser: cookie-based `createPagesBrowserClient`. Server (SSR path, no window): plain anon client with no session persistence.
- `lib/supabaseServer.ts` — `getSupabaseServerClient()`, a cached **service-role** client. Use only in API routes / `getServerSideProps` for privileged operations (bypasses RLS). Never expose to the client.
- `createPagesServerClient(ctx)` / `createPagesServerClient({ req, res })` (from `@supabase/auth-helpers-nextjs`) — session-aware server client used inside `getServerSideProps` and API routes to read the *calling user's* session/cookies before deciding whether to escalate to the service-role client.

The typical privileged API route pattern: read the session with `createPagesServerClient`, authorize, then do the actual read/write with `getSupabaseServerClient()`.

### Ops console (staff-only area)

- `middleware.ts` gates every `/ops/*` route: redirects to `/login` if there's no Supabase session (does not check staff role itself — that happens downstream).
- `lib/opsRbac.ts` defines `OpsRole` (`sales_agent | support_agent | ops_manager | admin`), the permission set, role→permission mapping, nav items, and `permissionForOpsPath()` which infers the required permission from a URL prefix.
- `lib/opsAuth.ts` provides `requireOpsStaff(ctx, options)` for `getServerSideProps` pages and `requireOpsStaffApi(req, res, options)` for API routes. Both: verify session → look up `staff_users` row → check `active` → check role is known → check permission (explicit or inferred from path) → log denials to `audit_log` via `logOpsForbiddenAttempt`. Use these rather than hand-rolling auth checks in new ops pages/routes.
- Staff identity (`staff_users`), audit trail (`audit_log`), and support tooling (`cases`, `booking_notes`, `guest_verifications`) are defined in `db/migrations/20260622_ops_console_schema.sql` — read this migration to see the ops data model before adding new ops features.
- Ops UI building blocks live in `components/ops/` (`OpsLayout`, `OpsTable`, `OpsFilterBar`, `OpsPageHeader`, `OpsStatusBadge`, `OpsMetric`, `OpsEmptyState`, etc.) — reuse these instead of building bespoke tables/headers per page.

### Booking domain

- `lib/calendarTypes.ts` defines the core shared vocabulary: `BookingStayType` (`nightly | day_use | split_rest | crashpad`) and `BookingChannel`.
- `lib/apiTypes.ts` defines request/response payload shapes for booking APIs; times are always ISO 8601 UTC strings.
- `pages/api/bookings/create.ts` is the canonical, most complex booking-creation flow: resolves stay type from listing config, evaluates flex availability/pricing (`lib/flexAvailability.ts`, `lib/flexPricing.ts`), computes guest pricing (`lib/pricing.ts`), and creates a Stripe checkout session.
- `lib/flexStay.ts` / `lib/sharedStay.ts` / `lib/sharedCheckout.ts` / `lib/sharedGroupsDb.ts` hold the date/pricing math and DB helpers for "flexible stay" (rolling checkout windows with a cutoff) and "shared/crew stay" (multi-guest, week-multiple-of-7-nights bookings with join modes) respectively. These are pure/near-pure helpers — prefer extending them over inlining date math in API routes.
- `lib/bookingStatus.ts` exports `isPaidFinalBookingStatus()` (true for `paid`/`confirmed`/`completed`, case-insensitive) — use it instead of comparing `booking.status` against a hardcoded string, since "paid" has more than one synonym in the data (see commit "Normalise paid and confirmed booking status handling").

### Calendar module

`modules/calendar/` is the host-facing calendar subsystem, self-contained:
- `hooks/useCalendarFeed.ts` fetches `/api/host/calendar/feed` and normalizes it into a `CalendarFeed` (listings, bookings, blocks, rates).
- `utils/mapFeedTo*Events.ts` adapt that feed into the shapes needed by each view (`HourlyView`, `MonthView`, `SchedulerView` — the last backed by DayPilot).
- `lib/calendarChannel.ts` maps channel identifiers (`booking`, `airbnb`, `vrbo`, `bookingcom`, `expedia`, `manual`) to display metadata (label, colors, icon) for iCal-synced and manual calendar entries.

### Schema-drift defensive pattern

Because Supabase schema changes are applied manually/out-of-band from deploys, API routes that touch newer columns/tables defensively detect "missing column/relation" Postgres errors (codes `42703`, `42P01`, PostgREST `PGRST204`, or message text like "schema cache" / "does not exist") and degrade gracefully (e.g. return a 503 with a friendly message, or skip an optional field) instead of hard-crashing. See `isMissingColumnError` in `lib/flexStay.ts` and the local `isMissingRelation`/`isMissingBookingColumnError` helpers in `pages/api/bookings/create.ts` and `pages/api/ops/cases/create.ts` for the pattern to follow when a route depends on a migration that may not have shipped to every environment yet.

### Role model

Users can be guest, host, or both (`lib/roleMode.ts`): `primary_role` (`guest | host | both`) plus a separately persisted `active_role` (which surface the UI is currently showing), stored in the profile and mirrored to `localStorage` under `flexivo.active_role`. Use `hasHostAccess`/`hasGuestAccess`/`resolveActiveRole` rather than reading `role_host`/`role_guest`/`primary_role` directly, since the precedence rules (e.g. "both" defaults to guest view) live there.

This is distinct from the staff `OpsRole` system above — a marketplace user's guest/host role has no relation to ops staff permissions.

## Payments philosophy: all-inclusive pricing

The guest-facing price must always be the final, all-inclusive amount payable — no fees or charges are added at a later checkout step. Concretely:

- Platform fees and Stripe's processing fees are absorbed into the price the guest sees up front (`lib/pricing.ts` — see `computeRoundedGuestPricing`, `roundGuestPricePenceToNearestFivePounds`), not itemized as separate add-ons at checkout.
- Hosts should receive the payout amount they were quoted, without silent/hidden deductions beyond the agreed platform fee (`STRIPE_APPLICATION_FEE_BPS`) taken via Stripe Connect.
- Never introduce a pricing surprise between what's shown pre-checkout and what's actually charged/paid out. If a change affects displayed price, application fee, or host net, treat it as a pricing-sensitive change and call it out explicitly rather than folding it into an unrelated commit.

## Engineering Principles

- Make small, incremental changes rather than sweeping ones.
- Never perform large architectural refactors without explicit approval — propose first, don't just do it.
- Explain significant design decisions before editing, not after.
- Preserve existing functionality; don't drop behavior as a side effect of a change.
- Extend existing systems (e.g. the schema-drift helpers, the ops RBAC layer, the flex/shared-stay libs) rather than rewriting them from scratch.
- Run `npm run typecheck` and `npm run lint` after any significant code change.
- Never consider work complete if `typecheck` or `lint` fails — fix it or say explicitly that it's failing and why, don't silently hand back broken output.

## Database Rules

- Never edit an existing migration file in `db/migrations/` unless explicitly instructed to — migrations are treated as immutable history once written.
- Always create a new, timestamped migration (`YYYYMMDD_description.sql`, matching the existing naming convention) for any schema change, rather than modifying an old one.
- Never weaken or remove a Row Level Security (RLS) policy without explicit instruction — every table added in `db/migrations/20260622_ops_console_schema.sql` and elsewhere enables RLS deliberately.
- Never expose the Supabase **service-role** key (`SUPABASE_SERVICE_ROLE_KEY`) to client code or any code path that ships to the browser — it must only be reachable via `lib/supabaseServer.ts` on the server. See "Supabase client boundaries" above.
- Prefer additive, backwards-compatible schema changes (new nullable columns, new tables) over destructive ones (dropping/renaming columns, tightening constraints on existing data), consistent with the schema-drift defensive pattern this codebase already relies on — a destructive change breaks that pattern's assumptions across environments that haven't migrated yet.

## Development Style

- One logical change at a time — avoid bundling unrelated fixes into a single edit.
- Never delete files without permission.
- Never modify database migrations unless requested (see Database Rules above).
- Explain reasoning before editing, especially for non-obvious or architecturally significant changes.
- Keep TypeScript strict where the code already is — don't loosen types (`any`, `as unknown as`, ts-ignore) to make an error disappear; note that `tsconfig.json` currently has `"strict": false` at the project level, so this means not degrading typing in the modules/files being touched, not fighting the existing compiler config.
- Reuse existing components and helpers (e.g. `components/ops/*`, `lib/flexStay.ts`, `lib/sharedStay.ts`) instead of duplicating logic.
- Prefer readable code over clever code.
- Maintain consistency with the existing architecture documented above rather than introducing a parallel pattern for the same problem.

## Git Workflow

- One logical change per commit.
- Do not commit automatically — only commit when explicitly asked.
- Summarise the changes made before suggesting a commit, so the user can confirm scope before anything is recorded.

## Roadmap

Current long-term direction, roughly in order:

1. Stripe Elements integration
2. Staff/Admin backend
3. Verification workflow
4. Messaging
5. Search & Maps improvements
6. Stripe Connect migration
7. Continued operational tooling

Treat items already in progress (e.g. the ops console, guest verification) as the current priority; don't preemptively build later roadmap items into unrelated work.
