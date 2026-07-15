import { describe, expect, it } from 'vitest';
import {
  FINANCIAL_SNAPSHOT_SCHEMA_VERSION,
  type FinancialSnapshotPayload,
} from './financialSnapshot.js';

/**
 * Kernel guardrail — Financial Snapshot `schemaVersion 1` CONTRACT test (governance G-3).
 * Fails if a v1 payload field is renamed, removed, or retyped, or if the schema version
 * is bumped without intent. New fields must be OPTIONAL and added to the allowed set.
 */
describe('kernel contract — FinancialSnapshot schemaVersion 1', () => {
  // Frozen v1 top-level shape. Renaming/removing a required key breaks this test.
  const REQUIRED_KEYS = [
    'netWorth',
    'assets',
    'liabilities',
    'debt',
    'cashflowSummary',
    'budgetSummary',
    'assetAllocation',
    'currencyExposure',
    'householdEquity',
    'entityHoldings',
    'relationships',
  ] as const;
  const OPTIONAL_KEYS = ['members'] as const;

  // A fully-populated, well-typed v1 payload (TS enforces the shape at compile time).
  const sample: FinancialSnapshotPayload = {
    netWorth: { assetsMinor: 100, liabilitiesMinor: 20, netWorthMinor: 80, solvencyRatio: 0.8 },
    assets: [{ accountId: 'a', name: 'A', assetClass: 'cash', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 100, baseBalanceMinor: 100 }],
    liabilities: [],
    debt: { totalOutstandingMinor: 20, totalMonthlyPaymentMinor: 2, weightedAvgRatePct: 8, debtCount: 1, byType: [{ type: 'home_loan', outstandingMinor: 20 }] },
    cashflowSummary: { period: '2026-03', incomeMinor: 100, expenseMinor: 60, netMinor: 40, savingsRate: 0.4, byCategory: [{ category: 'housing', amountMinor: 60 }] },
    budgetSummary: { period: '2026-03', exists: false, totalBudgetMinor: null, totalSpentMinor: 0, overTotal: false },
    assetAllocation: [{ assetClass: 'cash', baseValueMinor: 100, pct: 100 }],
    currencyExposure: [{ currency: 'INR', baseValueMinor: 100, pct: 100 }],
    householdEquity: { netWorthMinor: 80, totalDebtMinor: 20, reconciledEquityMinor: 60 },
    entityHoldings: [{ entityId: null, assetsMinor: 100, liabilitiesMinor: 0, debtOutstandingMinor: 20, netMinor: 80 }],
    relationships: { memberCount: 1, entityCount: 0, entityIds: [], accountIds: ['a'] },
    members: [{ memberId: 'm', ageYears: 40, isDependent: false, relation: 'self' }],
  };

  it('pins the schema version at 1', () => {
    expect(FINANCIAL_SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });

  it('has exactly the required top-level keys (plus only allowed optional keys)', () => {
    const keys = Object.keys(sample);
    for (const k of REQUIRED_KEYS) expect(keys).toContain(k);
    const allowed = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);
    for (const k of keys) expect(allowed.has(k)).toBe(true); // catches renames / stray fields
  });

  it('freezes the sub-fields consumers pin to', () => {
    expect(Object.keys(sample.netWorth).sort()).toEqual(['assetsMinor', 'liabilitiesMinor', 'netWorthMinor', 'solvencyRatio']);
    expect(Object.keys(sample.debt).sort()).toEqual(['byType', 'debtCount', 'totalMonthlyPaymentMinor', 'totalOutstandingMinor', 'weightedAvgRatePct']);
    expect(Object.keys(sample.cashflowSummary).sort()).toEqual(['byCategory', 'expenseMinor', 'incomeMinor', 'netMinor', 'period', 'savingsRate']);
    expect(Object.keys(sample.householdEquity).sort()).toEqual(['netWorthMinor', 'reconciledEquityMinor', 'totalDebtMinor']);
  });

  it('keeps members additive (optional, PII-light: age/dependency/relation only)', () => {
    expect(Object.keys(sample.members![0]!).sort()).toEqual(['ageYears', 'isDependent', 'memberId', 'relation']);
    // A payload without members is still valid v1 (backward compatibility).
    const { members: _omit, ...withoutMembers } = sample;
    void _omit;
    expect((withoutMembers as FinancialSnapshotPayload).members).toBeUndefined();
  });
});
