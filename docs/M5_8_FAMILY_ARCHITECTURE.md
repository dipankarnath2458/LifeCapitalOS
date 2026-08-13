# M5.8 PR 1 — Native Family + early-warning parity — Architecture

> **Status:** Design, written before implementation.
> **Scope:** `/household/family` becomes native and household-scoped; early-warning parity proven.
> Goals and charts are **PR 2** and are not touched here.
> **V2 is the primary consumer experience.** `/dashboard` and V1's `Family.tsx` remain deployed as
> the operationally recoverable safety net; Module 10 is the V1-retirement decision point.
> **No schema change, no migration, no encryption change, no design-system change.**

---

## 1. What is actually broken

Not styling. **Two member stores exist and only one is read.**

| Written by | Table | Keyed on | Read by the snapshot? |
| --- | --- | --- | --- |
| V1 `/family` (`family.module.ts:26,41,55`) | `FamilyMember` | `userId` | **No** |
| Onboarding + V2 | `HouseholdMember` | `householdId` | **Yes** (`household-financial-snapshot.service.ts:95`) |

So a consumer who adds their spouse and children in V1 changes **nothing** downstream:

- The dependants count that drives recommended life cover reads `payload.members` (`financialIntelligence.ts:270`)
- The ages that drive retirement read the same array (`:274`)

Both come from `HouseholdMember`. V1 writes the other table.

### 1.1 The consequence nobody has seen yet

V1's form captures **name, relation, dependant — and no date of birth**. `HouseholdMember.dateOfBirth`
exists but nothing populates it, and onboarding creates the self-member without one.

**Therefore retirement reports `available: false` for every consumer in the product today**, with the
reason *"No member age available to project retirement."* Not a wrong number — an entire panel that
has never rendered for anyone. Confirmed while writing the Issue 2 tests, where a retirement
assertion failed until the test set a date of birth explicitly.

Turning that on is the point of this PR.

## 2. What this builds

A native surface at `/household/family` on the **existing** household members API. No API is added:

| Verb | Route | Already exists |
| --- | --- | --- |
| List | `GET /households/:id/members` | ✅ |
| Add | `POST /households/:id/members` | ✅ |
| Edit | `PATCH /households/:id/members/:mid` | ✅ |
| Remove | `DELETE /households/:id/members/:mid` | ✅ |

Guarded by `HouseholdScopeGuard` (404-not-403); writes limited to `OWNER`/`ADVISOR`/`SUPPORT`. A
consumer is `OWNER` of their personal firm, so the existing authorization already fits.

`HouseholdMember` already carries every field required — `name` (encrypted), `relation`,
`dateOfBirth`, `isDependent`, `householdRole`, `userId` — and the DTOs already accept them.
**Nothing in `prisma/` changes.**

**Editing is the most important verb here**, not adding: it is how an existing consumer puts a date
of birth on the self-member created at onboarding, which is what makes retirement appear.

## 3. The self-member deletion guard

### The hazard

`HouseholdMember.userId` is the **post-login routing signal**. `findOwnHousehold` resolves it into
`hasOwnHousehold`, and `postLoginDestination.ts:58` checks it first.

Delete the row and the chain runs: `hasOwnHousehold` → false; `firms.length > 0` → true (every
consumer has a personal firm since M5.5); destination → `/app`, **the Advisor Workspace**.

A consumer would be silently exiled from their own product by pressing a delete button — the same
failure mode as #52 and #54, reached through a new door.

### The guard

`remove()` rejects deletion when the member has `userId` set — that is, when the member has a portal
login and their routing depends on this row.

Deliberately narrow:

- **Condition is exactly the existing self-member condition** (`userId != null`). No new column, no
  new concept, no inference from `relation`, which is free text and could be anything.
- **Advisor and support deletion behaviour is unchanged** for every other member. A client's spouse,
  children and dependants delete exactly as they do today.
- **Enforced in the API, not the UI.** The UI hides the control, but a UI guard is one request away
  from being bypassed and the consequence is losing access to your own dashboard. The API is
  authoritative; the UI restriction is presentation only.

Removing a member who has a portal login is a real operation — it just is not a *delete*. It means
revoking access, which belongs with membership management, not with editing the family list.

## 4. Early-warning parity — and its honest limit

Both paths compose the **same engine**: V1's `/insights/early-warning` and the FIL's `risk` section
both call `computeEarlyWarning` (`financialIntelligence.ts:544`). Parity is therefore structural,
and the test proves the composition does not distort it.

**Exact parity is not achievable yet.** V1's early warning includes `goalSlippage`; the snapshot
payload has no goals section at all, so no goal-derived signal can appear in V2's `risk`.

The test asserts parity on **every non-goal signal** and records the gap rather than hiding it
behind a weaker assertion. Closing it fully requires goals in the snapshot — PR 2's territory, and
not smuggled in here.

## 5. What this does not do

- No Goals, no charts (PR 2)
- No schema change, no migration
- No encryption change; member names stay encrypted at rest through the existing `CryptoService`
- No design-system change — composed from `@/ui`, never edited
- No advisor-created-goal scope
- **`apps/web/src/components/Family.tsx` is not modified.** It stays mounted on `/dashboard` as the
  safety net, reading `FamilyMember`, exactly as today
- No change to any unrelated module

## 6. The two stores, after this PR

`FamilyMember` and `HouseholdMember` both continue to exist. This PR does **not** migrate data
between them, and does not delete either.

That is deliberate: V1 remains the recoverable safety net until Module 10, and copying rows between
stores is a data migration with its own approval — not something to fold into a UI milestone. The
consumer-facing consequence is that the V2 surface is now the one that counts, because it writes the
table the snapshot reads.

## 7. Tests and acceptance criteria

**Done when:**

1. A consumer can add, edit and remove household members natively at `/household/family`
2. Adding a date of birth makes **Retirement render a projection** instead of `available: false`
3. Adding a dependant raises **`insurance.recommendedCoverMinor`**
4. Member names are **encrypted at rest**, decrypted only through the guarded read
5. **Self-member deletion is rejected by the API**
6. `/dashboard` and V1 `Family.tsx` still work, untouched
7. Early-warning parity holds for all non-goal signals

**Tests**

- *Members e2e* — CRUD round-trip; name encrypted at rest (raw row ≠ plaintext); another firm's
  household is 404; DOB reaches `payload.members[].ageYears`
- *Self-member guard e2e* — deleting the self-member is rejected; deleting an ordinary member still
  succeeds; the routing signal survives
- *Retirement unlock e2e* — the same household before and after a DOB
- *Dependants e2e* — recommended cover rises when a dependant is added
- *Parity e2e* — equivalent figures on both paths; non-goal signals match
- *Smoke* — the browser journey, ending on a visible Retirement panel
- *Safety net* — `/dashboard` renders; V1 family CRUD still works

**Teeth:** every new test is confirmed to fail against the previous behaviour before it is trusted.

## 8. Rollback

Additive. `git revert` the merge restores the temporary surface, whose components are all still
present. **No data implications** — no schema change, no migration, nothing re-keyed. Members created
through the V2 surface remain valid rows that the snapshot already reads.
