import { describe, expect, it } from 'vitest';
import {
  AI_REDACTION_VERSION,
  buildAiGroundingContext,
  containsNoPiiKeys,
} from './aiGrounding.js';
import { computeHouseholdFinancialIntelligence } from './financialIntelligence.js';
import type { FinancialSnapshotPayload } from './financialSnapshot.js';

describe('AI grounding + PII redaction contract', () => {
  const payload: FinancialSnapshotPayload = {
    netWorth: { assetsMinor: 100, liabilitiesMinor: 20, netWorthMinor: 80, solvencyRatio: 0.8 },
    assets: [{ accountId: 'acc_secret', name: 'Rahul HDFC', assetClass: 'cash', entityId: 'ent_x', nativeCurrency: 'INR', nativeBalanceMinor: 100, baseBalanceMinor: 100 }],
    liabilities: [],
    debt: { totalOutstandingMinor: 20, totalMonthlyPaymentMinor: 2, weightedAvgRatePct: 8, debtCount: 1, byType: [] },
    cashflowSummary: { period: '2026-03', incomeMinor: 100, expenseMinor: 60, netMinor: 40, savingsRate: 0.4, byCategory: [] },
    budgetSummary: { period: '2026-03', exists: false, totalBudgetMinor: null, totalSpentMinor: 0, overTotal: false },
    assetAllocation: [{ assetClass: 'cash', baseValueMinor: 100, pct: 100 }],
    currencyExposure: [{ currency: 'INR', baseValueMinor: 100, pct: 100 }],
    householdEquity: { netWorthMinor: 80, totalDebtMinor: 20, reconciledEquityMinor: 60 },
    entityHoldings: [{ entityId: 'ent_x', assetsMinor: 100, liabilitiesMinor: 0, debtOutstandingMinor: 20, netMinor: 80 }],
    relationships: { memberCount: 2, entityCount: 1, entityIds: ['ent_x'], accountIds: ['acc_secret'] },
    members: [{ memberId: 'mem_secret', ageYears: 42, isDependent: false, relation: 'self' }],
  };
  const envelope = {
    snapshotId: 'snap_1',
    schemaVersion: 1,
    engineVersion: 'm2-6.1.0',
    fxVersion: 'static-v1',
    currency: 'INR',
    capturedAt: '2026-03-31T00:00:00.000Z',
    status: 'active',
  };

  it('presents net worth AFTER the debt ledger, under the name a reader reaches for', () => {
    // The defect, asserted on the grounding payload itself rather than on anything rendered.
    //
    // This block used to be `payload.netWorth` passed straight through, whose `netWorthMinor` is
    // assets minus liability ACCOUNTS only. A consumer's loans live in the debt ledger, so a
    // model asked what a family was worth quoted the field called `netWorth.netWorthMinor` and
    // overstated it by the whole mortgage. The reconciled figure was present, but only under
    // `householdEquity.reconciledEquityMinor` — a name that does not say "net worth".
    //
    // Fixture: assets 100, liability accounts 20 → 80 gross; ledger debt 20 → 60 actually owned.
    const { netWorth } = buildAiGroundingContext(envelope, payload).financial;
    expect(netWorth.netWorthMinor).toBe(60);
    expect(netWorth.grossNetWorthMinor).toBe(80);
    expect(netWorth.assetsMinor).toBe(100);
    expect(netWorth.liabilitiesMinor).toBe(20);
    expect(netWorth.totalDebtMinor).toBe(20);
    // The ratio must agree with the net worth beside it: 60 / 100.
    expect(netWorth.solvencyRatio).toBeCloseTo(0.6, 10);
  });

  it('states the definition in the context, not only in the field names', () => {
    // A model reads prose as readily as it reads keys, and this is the distinction it got wrong.
    const notes = buildAiGroundingContext(envelope, payload).notes.join(' ');
    expect(notes).toMatch(/netWorthMinor is AFTER all borrowings/);
    expect(notes).toMatch(/grossNetWorthMinor excludes the debt ledger/);
  });

  it('reconciles a snapshot captured before householdEquity existed', () => {
    // Older payloads have no `householdEquity`; the grounding must still subtract the ledger
    // rather than silently falling back to the gross figure.
    const { householdEquity: _dropped, ...legacy } = payload;
    const { netWorth } = buildAiGroundingContext(
      envelope,
      legacy as FinancialSnapshotPayload,
    ).financial;
    expect(netWorth.netWorthMinor).toBe(60);
    expect(netWorth.grossNetWorthMinor).toBe(80);
  });

  it('agrees with the intelligence layer field for field', () => {
    // The property that keeps this from drifting again: the dashboard and the model describe the
    // same household with the same numbers under the same names, from one shared reconciliation.
    const g = buildAiGroundingContext(envelope, payload).financial.netWorth;
    const fil = computeHouseholdFinancialIntelligence({
      payload,
      meta: { householdId: 'hh_1', snapshotId: 'snap_1', snapshotSchemaVersion: 1, currency: 'INR' },
      computedAt: '2026-04-01T00:00:00.000Z',
    }).netWorth;
    expect(fil.available).toBe(true);
    if (!fil.available) return;
    expect(g.netWorthMinor).toBe(fil.data.netWorthMinor);
    expect(g.grossNetWorthMinor).toBe(fil.data.grossNetWorthMinor);
    expect(g.totalDebtMinor).toBe(fil.data.totalDebtMinor);
    expect(g.assetsMinor).toBe(fil.data.assetsMinor);
    expect(g.liabilitiesMinor).toBe(fil.data.liabilitiesMinor);
    expect(g.solvencyRatio).toBeCloseTo(fil.data.solvencyRatio, 10);
  });

  it('is deterministic', () => {
    expect(buildAiGroundingContext(envelope, payload)).toEqual(buildAiGroundingContext(envelope, payload));
  });

  it('stamps provenance + redaction version', () => {
    const g = buildAiGroundingContext(envelope, payload);
    expect(g.provenance.snapshotId).toBe('snap_1');
    expect(g.provenance.schemaVersion).toBe(1);
    expect(g.provenance.redactionVersion).toBe(AI_REDACTION_VERSION);
  });

  it('keeps aggregates but drops per-account rows and raw ids', () => {
    const g = buildAiGroundingContext(envelope, payload);
    // 80 is the accounts-only figure, and it is still here — under the name that says so.
    // `netWorthMinor` is asserted in its own test above, where the distinction is the point.
    expect(g.financial.netWorth.grossNetWorthMinor).toBe(80);
    expect(g.financial.assetAllocation[0]!.pct).toBe(100);
    expect(g.structure).toEqual({ memberCount: 2, entityCount: 1, accountCount: 1 });
    // no assets[]/liabilities[]/entityHoldings[]/relationships id arrays on the context
    expect((g.financial as Record<string, unknown>).assets).toBeUndefined();
  });

  it('emits demographics without member ids', () => {
    const g = buildAiGroundingContext(envelope, payload);
    expect(g.demographics).toEqual([{ ageYears: 42, isDependent: false, relation: 'self' }]);
  });

  it('contains no PII-ish keys anywhere (name/taxId/dob/account/entity/member ids)', () => {
    const g = buildAiGroundingContext(envelope, payload);
    expect(containsNoPiiKeys(g)).toBe(true);
    // sanity: the guard actually detects PII when present
    expect(containsNoPiiKeys({ nested: [{ accountId: 'x' }] })).toBe(false);
    expect(containsNoPiiKeys({ ok: { pct: 10 } })).toBe(true);
  });

  it('handles snapshots without the optional members field', () => {
    const { members: _omit, ...noMembers } = payload;
    void _omit;
    const g = buildAiGroundingContext(envelope, noMembers as FinancialSnapshotPayload);
    expect(g.demographics).toEqual([]);
  });
});
