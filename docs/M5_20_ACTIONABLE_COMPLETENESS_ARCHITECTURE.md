# M5.20 — "Make this more accurate" becomes something a family can act on

> **Status: implemented.** Every figure below was read or measured from source at `8e86bd0`
> (`origin/main` after M5.19), not recalled.
>
> **Presentation only.** No engine, kernel, schema, migration or version change. Same data → same
> `missing[]` → same `pct` → words a family can read, and somewhere to go. Nothing computed here.

---

## 1. The defect

`/household` renders the completeness panel — the product's single most action-oriented surface,
whose heading is literally an instruction — like this:

> **Make this more accurate**
> We have 67% of the picture. Still missing: `memberAges`, `insurancePolicies`,
> `retirementAssumptions`.

Those are the engine's own identifiers (`financialIntelligence.ts:493-498`), joined with commas
and printed. Captured verbatim by the perturbation run in §4:
`"memberAgesinsurancePoliciesretirementAssumptions"`.

Read precisely, that is **two** defects, and this codebase has already fixed each of them
separately:

1. **An engine key reaching a family as copy.** The M5.17 defect, in a second place.
2. **An instruction with nowhere to go.** The M5.18 defect — and this is a panel whose entire
   purpose is to be acted on.

A family does not know what `memberAges` is. Even if they guessed, nothing on the panel says
which of seven pages records one.

**It is not an edge case.** `memberAges` is missing for *every* newly onboarded family, because
neither onboarding nor the Wealth Health Check records a date of birth — the same fact M5.17 §6
turned on. Most families see this panel, and most see it naming something they cannot act on.

## 2. What was built

One map in `apps/web/src/lib/intelligence.ts`, beside `ASSET_CLASS_LABEL` and following it
exactly:

```ts
export const MISSING_LABEL: Record<string, { label: string; href?: string; cta?: string }> = {
  income:                { label: 'what you earn each month',                 href: '/wealth-health',        cta: 'Add it in your Wealth Health Check' },
  expenses:              { label: 'what you spend each month',                href: '/wealth-health',        cta: 'Add it in your Wealth Health Check' },
  assets:                { label: 'what you own',                             href: '/wealth-health',        cta: 'Add it in your Wealth Health Check' },
  memberAges:            { label: "your family's dates of birth",             href: '/household/family',     cta: 'Add them on your Family page' },
  insurancePolicies:     { label: 'the insurance you already hold',           href: '/household/protection', cta: 'Record it on your Protection page' },
  retirementAssumptions: { label: 'when you want to retire, and what you save', href: '/household/retirement', cta: 'Set it on your Retirement page' },
};
```

The panel renders one row per gap instead of a comma-joined string.

### Why a destination, not just a label

Naming the gap in words alone would be the M5.17 half of the fix. The reason this panel exists is
to be acted on, and a family who now understands we lack their ages still has to guess where to
record one. **Every key already has a V2 surface that captures exactly it**, and each was checked
against the page rather than assumed:

| Key | Page | What it records there |
| --- | --- | --- |
| `income`, `expenses`, `assets` | `/wealth-health` | the wizard's own figures |
| `memberAges` | `/household/family` | `dateOfBirth` (`family/page.tsx:106`) |
| `insurancePolicies` | `/household/protection` | `hasTermCover` (`protection/page.tsx:158`) |
| `retirementAssumptions` | `/household/retirement` | `retirementAge`, `monthlyContributionMinor` |

### An unknown key still reaches the family

`missingItem` falls through to readable text — `taxRegime` → `tax regime` — **with no link**. A
gap the engine gains tomorrow must not vanish from the panel just because this map has not caught
up, and sending a family to a page that does not record it would be worse than sending them
nowhere. Same degrade behaviour as `assetClassLabel`, and the same reason.

## 3. Financial invariants

Nothing financial is touched. Stated explicitly because the panel sits beside figures that are:

| Invariant | Why it holds |
| --- | --- |
| `dataCompleteness.pct` | Computed in the engine; this reads it and renders it unchanged |
| `dataCompleteness.missing` | The engine decides membership; this decides wording. §4 pins that the map invents no key |
| Every figure on the dashboard | Not in this diff |
| `SCHEMA_VERSION`, `ENGINE_VERSION`, `MODEL_VERSION` | No engine change |
| Kernel, Prisma, migrations, API | Untouched — web-only |

## 4. Tests

Five new unit cases and one browser journey. No test weakened or rewritten.

The unit cases pin the fix as *presentation*:

- **covers every key the engine can report** — asserts the whole set against the six keys read
  from `financialIntelligence.ts`, rather than spot-checking. A seventh key added to the engine
  fails this, which is how the map learns about it.
- **never shows a family an engine identifier** — no camelCase, no underscores, nothing that reads
  like a variable.
- **points every gap at a page that actually records it** — each `href` asserted individually.
- **degrades readably, without inventing a destination** — the unknown key gets words and no link.
- **introduces no gap of its own** — every key here is one the engine emits. A key in this map the
  engine never reports would be a gap invented by the web layer.

**Every new case was proven to bite:**

| Perturbation | What failed |
| --- | --- |
| **A** — panel reverted to `missing.join(', ')` | the browser journey, on the panel element |
| **B** — panel, list and testid kept; only the **copy** reverted to the raw key | the browser journey, on **content**: `Expected substring: "your family's dates of birth"` · `Received string: "memberAgesinsurancePoliciesretirementAssumptions"` |
| **C** — the map forgets `memberAges` | 2 unit cases: "covers every key", "points every gap" |

Perturbation A alone was a **weak proof** and was not accepted as one: it showed the `data-testid`
had moved, not that a family stopped reading engine keys. B was written to fail on the copy with
the element still present, and its `Received` string is the defect itself, captured.

## 5. Explicitly out of scope

- **Changing what counts as missing, or how `pct` is computed.** The engine owns both.
- **Adding a gap the engine does not report** — e.g. a goal, a budget. If it belongs in
  completeness it belongs in `financialIntelligence.ts`, not here.
- **Nagging.** No modal, no badge, no auto-navigation. The panel appears when there is a gap and
  is silent when there is not, exactly as before.
- **Advisor surfaces.** Still separately tracked.
