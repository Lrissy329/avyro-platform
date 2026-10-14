# Shared Stays: hidden for launch

Shared Stay is **hidden, not removed**. All of its code, components, routes, copy, migrations and data are
still in the repo. One switch controls it.

## What the feature is

A host lists one property and splits it into individual **spaces** (`shared_total_spots`). Each guest books and
pays for their own space, per person per week, in whole weeks (`shared_min_weeks`..`shared_max_weeks`).
The first guest to book creates a **group** for those dates; others can then join it until it is full.
A joining guest is a row in `shared_group_members`, and their payment is a `bookings` row with
`booking_type = 'shared_group'`.

## The switch

```
NEXT_PUBLIC_SHARED_STAYS_ENABLED=true     # ON
(unset, or anything other than "true")    # OFF  (default)
```

Defined in `lib/featureFlags.ts` (`SHARED_STAYS_ENABLED`).

- It is `NEXT_PUBLIC_` because browser code has to read it. Next.js **bakes it in at build time**, so change it
  in the deploy environment and **rebuild/redeploy**. Locally, restart `npm run dev`.
- Every gated block carries the marker `SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md`.
  Find them all with:

  ```bash
  grep -rn "SHARED_STAYS (disabled for launch)" pages components lib
  ```

## What is gated (flag OFF)

| Area | File | Behaviour while OFF |
|---|---|---|
| Flag | `lib/featureFlags.ts` | Defines the flag and the API response body |
| Discovery | `pages/search.tsx` | Query adds `is_shared_stay IS NOT TRUE`, so shared listings never appear. A stray `?shared_stays=true` is ignored (normal results, no error). The filter-count, active-filter chip and the "Shared stays" checkbox in Filters are hidden. |
| Discovery | `pages/index.tsx` | Homepage listing query excludes shared listings the same way. Dev-only preview sample drops its shared item. |
| Listing page | `pages/listing/[id].tsx` | A shared listing shows the normal "Listing not found." |
| Server | `pages/api/listings/[id]/index.ts` | 404 for a shared listing |
| Server | `pages/api/listings/[id]/availability.ts` | 404 for a shared listing |
| Server | `pages/api/shared-groups/checkout.ts` | 404 `{"code":"SHARED_STAYS_DISABLED"}` (after the method check, before auth or any work) |
| Server | `pages/api/shared-groups/options.ts` | 404 `{"code":"SHARED_STAYS_DISABLED"}` |
| Homepage copy | `pages/index.tsx` | Feature strip, How-it-works step 2 (and its "Shared" pill), and the Stay-formats subhead use neutral wording. Original copy is kept behind the flag. |
| Homepage layout | `pages/index.tsx` | The Shared stays card is not rendered. The Flexible card becomes full-width (horizontal on desktop). Footer "Shared stays" link removed. |
| Host: create | `pages/host/create-listing.tsx` | "Shared stay" model card not offered; selecting it is ignored |
| Host: edit | `pages/listing/[id]/edit.tsx` | Shared toggle and fields hidden; hidden fields skip validation; the save **omits** `is_shared_stay` and every `shared_*` column, so stored values are untouched |
| Host: dashboard | `pages/host/dashboard.tsx` | Shared Stay promo card and guide hidden |

## Deliberately NOT changed (still work with the flag OFF)

These are left alone so existing data and money stay safe:

- `pages/api/stripe-webhook.ts` (finalises and expires **both** normal and shared payments)
- `components/BookingWidget.tsx` and all of `components/shared-stay/*`, `hooks/useSharedStayCheckout.ts`
- `pages/guest/bookings/[id].tsx` (existing shared bookings stay viewable)
- Host calendar (`pages/api/host/calendar/feed.ts`, `modules/calendar/*`), ops pages, search internals and map pins
- `pages/host/listings/index.tsx` (a host still sees their own shared listing there)
- `lib/shared*.ts`, all migrations, and all data (tables `shared_groups`, `shared_group_members`,
  `bookings.booking_type/shared_group_id`, `listings.shared_*`)
- `pages/api/bookings/create.ts` and `quote.ts` already reject shared listings (they say to use shared checkout)

## Known limits while OFF

- **Hidden, not stripped.** The bundler does not remove the disabled branches, so the shared copy is still present
  in the compiled JavaScript (someone reading the page source or bundle could find it). It is not rendered or
  reachable through the UI. If you ever need it gone from the shipped code, that is a separate, larger change.
- **Hosts write listings straight to Supabase from the browser** (RLS-protected), so there is no server route to
  gate for "create a shared listing". The create/edit UI no longer offers it and the public surfaces hide any
  such listing, but a determined host using the API directly could still set `is_shared_stay`. Public discovery,
  the listing page and both shared APIs treat it as hidden regardless.
- Existing shared listings (at the time of writing: "2 Bed Annex..." and "Test Shared") are **hidden from the public**
  but still exist and still show for their host in `/host/listings`. Convert or remove them before launch if you want
  them live as normal listings (a data change, not part of this switch).
- All existing shared groups/members/bookings are `cancelled` test data. Four shared bookings are `cancelled` with
  Stripe status `paid`: confirm they were refunded if they were made with live Stripe keys.

## How to re-enable

1. Work through the checklist below.
2. Set `NEXT_PUBLIC_SHARED_STAYS_ENABLED=true` in the deploy environment (and `.env.local` for local).
3. Rebuild and redeploy (the value is baked in at build time).
4. Run the ON walkthrough in "QA" and the curl checks below, expecting the ON results.
5. Optional: restore the marketing copy (already in the code behind the flag, nothing to write).

## Re-enable checklist

- [ ] **HMO / licensing advice.** Several unrelated professionals sharing one dwelling can make it a House in
      Multiple Occupation. Get advice for each launch council (mandatory or additional/selective licensing,
      fire safety, room-size and amenity standards, planning use class). Decide whether Flexivo requires hosts to
      confirm their licence status and store evidence.
- [ ] **Host opt-in.** Shared stay must be an explicit, informed host choice with the obligations shown before they
      enable it (not a default toggle). Record consent. Decide how a host with a listing already live switches
      model, and what happens to existing bookings.
- [ ] **Minimum-occupancy rules.** Decide what happens if a group never fills: minimum guests to proceed, a cut-off
      date, who is refunded and when, and whether the host is paid for a part-filled group. Today the first guest
      pays for their own space regardless of who else joins.
- [ ] **Inventory and pricing rules.** Confirm the capacity model (`shared_total_spots`, one active group per date
      window, DB triggers from migrations `20260325` and `20260815`), the per-person weekly price rounding
      (`computeSharedPerPersonWeeklyPricePence`), whole-week rule, what "full" means with pending holds, hold
      expiry (30 min), and the "all-inclusive price" rule from `CLAUDE.md` for the split price.
- [ ] **Payments and Connect.** Re-test shared checkout against the current Connect destination-charge flow,
      webhook idempotency, refunds and payout timing per member, including a member cancelling in an active group.
- [ ] **RLS / data access.** `shared_groups` and `shared_group_members` had RLS reconciled in `20260817`. Re-check
      what the public key can read, since search reads group occupancy.
- [ ] **Copy review.** Re-read every shared string for accuracy and consistency with legal advice: homepage
      (strip, step 2, Stay formats card, footer), search filter, cards, listing widget, host promo, emails
      (`lib/email/sendBookingEmails.ts`), guest booking page.
- [ ] **Host and guest policies.** Terms, house rules for co-guests, cancellation, and safety/verification of the
      other people in the property.
- [ ] **QA** (below).

## QA

**Flag OFF (launch state):** nothing shared-related is visible or reachable.

- Homepage: no Shared card, no "shared" wording, no "Shared stays" footer link, Flexible card full-width
  (check desktop, tablet, mobile).
- `/search` and `/search?shared_stays=true`: normal results, no shared listings, no error.
- Create listing: only Standard and Flexible models.
- Edit a listing: no shared toggle/fields; saving does not change stored shared values.
- Host dashboard: no Shared Stay promo card.
- Direct URL of a shared listing: "Listing not found."
- curl checks below all return the OFF results.

**Flag ON:** the feature works as before: shared listings in search and on the homepage, the Shared card and
footer link, the listing widget (dates, week tabs, join/start), shared checkout, the host create/edit options.

## curl checklist (direct-request checks)

Replace `BASE` (for example `http://localhost:3000`), `SHARED_ID` (a listing with `is_shared_stay = true`) and
`NORMAL_ID` (a normal listing).

```bash
BASE=http://localhost:3000
SHARED_ID=<uuid of a shared listing>
NORMAL_ID=<uuid of a normal listing>
```

| Request | Flag OFF | Flag ON |
|---|---|---|
| `curl -s -o /dev/null -w "%{http_code}" $BASE/api/listings/$SHARED_ID` | **404** | 200 |
| `curl -s -o /dev/null -w "%{http_code}" $BASE/api/listings/$NORMAL_ID` | 200 | 200 |
| `curl -s -o /dev/null -w "%{http_code}" "$BASE/api/listings/$SHARED_ID/availability?from=2027-01-04&to=2027-02-01"` | **404** | 200 |
| `curl -s -o /dev/null -w "%{http_code}" "$BASE/api/listings/$NORMAL_ID/availability?from=2027-01-04&to=2027-02-01"` | 200 | 200 |
| `curl -s "$BASE/api/shared-groups/options?listingId=$SHARED_ID&checkIn=2027-01-04&checkOut=2027-01-11"` | **404** body has `"code":"SHARED_STAYS_DISABLED"` | 200 |
| `curl -s -X POST $BASE/api/shared-groups/checkout -H "Content-Type: application/json" -d '{}'` | **404** `SHARED_STAYS_DISABLED` | 401 (needs a signed-in token) |
| `curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/bookings/create -H "Content-Type: application/json" -d '{"listingId":"'$SHARED_ID'"}'` | 401 (unauthenticated), and 409 for a signed-in caller | same |

Also confirm a normal booking is unaffected: create a normal booking through the widget and reach Stripe Checkout
(needs a signed-in guest and a Stripe-ready host; this was not exercised in the automated launch check).

Page checks. Count **visible** mentions on the homepage (scripts and styles stripped, since the raw HTML also
carries JavaScript):

```bash
curl -s "$BASE/" | python3 -c "import sys,re,html; t=re.sub(r'<script.*?</script>|<style.*?</style>',' ',sys.stdin.read(),flags=re.S); t=html.unescape(re.sub(r'<[^>]+>',' ',t)); print(len(re.findall(r'\bshared?\b',t,flags=re.I)))"
# OFF: 0    ON: 8 (as of this writing)

curl -s "$BASE/search?shared_stays=true" -o /dev/null -w "%{http_code}\n"   # 200 in both states (search is client-rendered)
```

Results seen when this was verified (production builds, flag OFF / ON):

- Homepage visible "shared" mentions: **0 / 8**; footer link `/search?shared_stays=true`: absent / present;
  `shared-stay.webp` referenced: no / yes.
- Search for STN: **1 stay** ("Flex test") / 3 stays. `?shared_stays=true` OFF: still 1 stay, no error. ON: chip
  "Shared stays" and 2 stays. "Shared stays" checkbox in Filters: absent / present.
- Listing page of a shared listing: "Listing not found." / normal page. Normal listing: unchanged.
- Create listing: Standard + Flexible only / plus Shared (and its explainer opens).
- Edit listing (save payload captured, nothing sent): OFF has no `is_shared_stay` and no `shared_*` keys (25 keys),
  ON has those six (31 keys). A listing that *is* shared saves fine OFF and its stored shared values are untouched.
- Host dashboard promo card: gated by a one-line boolean (`SHARED_STAYS_ENABLED && ...`). The dashboard is
  server-guarded by login, so it was verified by code review and type-check, not rendered.
