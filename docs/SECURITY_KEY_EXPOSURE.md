# FIELD_ENCRYPTION_KEY exposure — 2026-08-13

> **Status: DEFERRED / DOCUMENTED.** Not unresolved, and not fixed.
> **Rotation is intentionally postponed** and **must be revisited before real customer data is
> introduced.** See §5 for the trigger conditions.
> **No code changed. Encryption behaviour is unchanged. The key was not rotated and the Railway
> variable was not modified.**

---

## 1. What happened

The production `FIELD_ENCRYPTION_KEY` was visible in a screenshot.

| | |
| --- | --- |
| Where it went | Shared **privately in ChatGPT** |
| Public exposure | **None** — not posted publicly, not via GitHub, Slack or email |
| Other secrets in the same image | **Masked** — only this key was legible |
| This key | **Fully visible** |

**The key is treated as compromised.** It is outside the founder's control and cannot be
un-disclosed.

## 2. What the key protects, and what exposure actually costs

Six columns, AES-256-GCM, verified by enumerating every `crypto.encrypt()` call site against the
schema:

| Table | Column |
| --- | --- |
| `Profile` | `fullName` |
| `Household` | `name` |
| `HouseholdMember` | `name` |
| `Entity` | `name` |
| `Entity` | `taxId` (**PAN**) |
| `FamilyMember` | `name` |

No financial amounts are encrypted — balances, transactions and debts are plaintext, protected by
tenancy scoping.

**A leaked key decrypts nothing without the ciphertext.** Postgres is on Railway's private network
and is not publicly reachable, and `DATABASE_URL` was masked in the same screenshot. So exploitation
requires a *second, independent* compromise that the holder does not have.

**Material exposure at the time of writing: 2 active households, both belonging to the founder, no
real customer data.** The names and PANs this key protects are the founder's own.

This is why rotation is deferred rather than urgent. The judgement would invert the moment a real
family's data exists.

## 3. Actions taken

| # | Action | Owner | Status |
| --- | --- | --- | --- |
| 1 | Document the exposure and the deferral | this record | **Done** |
| 2 | Back up the current key outside Railway (password manager) | founder | Confirmed |
| 3 | Confirm Railway Postgres automatic backups and a current backup exists | founder | Confirmed |

Action 2 is not a formality. The key is compromised but **not useless** — it remains the only thing
that can read existing data *and any database backup of it*. Discarding it would destroy the
recovery path without improving security in any way.

**Deliberately not done:** no rotation, no dual-key support, no re-encryption migration, no change
to the Railway variable, no production code change. The key value has never been retrieved, printed
or logged by the assistant, and does not appear in this repository.

## 4. What a rotation would require (assessed, not built)

Recorded so the work is understood rather than rediscovered under pressure. The full assessment is
in the session record; the load-bearing findings:

- **Every ciphertext is self-describing** — stored as `iv:authTag:ciphertext` with a random 12-byte
  IV per value. Rows can therefore be migrated independently, in any order, resumably.
- **No encrypted column is indexed, unique, filtered or sorted on.** Re-encryption breaks no
  constraint and no query.
- **`hash()` does not use the key** (plain SHA-256), so rotation would not invalidate sessions,
  refresh tokens or OTPs. Nobody gets logged out.
- **A wrong key throws; it does not silently return junk.** GCM authenticates, so a failed
  migration is loud. (This corrects `V2_PROJECT_INVENTORY.md` §22, which stated the opposite —
  verified empirically before relying on it.)
- **No migration utility exists.** `CryptoService` supports exactly one key.
- **Rotation without migration would lock every user out**, not merely hide names: profile
  decryption sits on the sign-in path (`auth.controller.ts:110`), and only one decrypt site in the
  codebase is wrapped in try/catch (`onboarding.service.ts:248`).

The safe sequence, if it is ever run: deploy decrypt-only fallback for the old key → migrate and
verify per row → prove zero rows need the old key → only then retire it. Old key retained
throughout, so every stage is reversible.

**A cheaper alternative exists while the data is small:** delete and re-enter the affected records
under a new key. Far less machinery for the same outcome. It stops being an option the moment real
customers exist.

## 5. When this must be revisited — trigger conditions

Any **one** of these ends the deferral:

1. **Before the first real customer's data is entered.** This is the hard gate.
2. Evidence the key reached any third party beyond the original private context.
3. `DATABASE_URL`, or any credential granting database access, is exposed.
4. Postgres becomes reachable from the public internet.
5. Any additional field is added to the encrypted set (raises the value of the key).

Until then this item is **DEFERRED — accepted risk, recorded, with a named trigger** — not an
oversight and not an open vulnerability.

## 6. Standing rules for handling this key

- Never paste it into a chat, screenshot, issue, PR, log line or commit.
- Never store it only in Railway. Two independent copies outside it, minimum.
- Never rotate it as a variable edit — that is a migration project, not a config change.
- Reveal it in the Railway UI only when nothing is recording the screen.
