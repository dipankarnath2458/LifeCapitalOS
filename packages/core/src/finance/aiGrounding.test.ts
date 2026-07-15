import { describe, expect, it } from 'vitest';
import {
  AI_REDACTION_VERSION,
  buildAiGroundingContext,
  containsNoPiiKeys,
} from './aiGrounding.js';
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
    expect(g.financial.netWorth.netWorthMinor).toBe(80);
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
