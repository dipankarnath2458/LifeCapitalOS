import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FinancialSnapshot, Prisma } from '@prisma/client';
import {
  canonicalStringify,
  convertMinor,
  CurrencyCode,
  FINANCIAL_SNAPSHOT_ENGINE_VERSION,
  FINANCIAL_SNAPSHOT_SCHEMA_VERSION,
  type FinancialSnapshotPayload,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { FxService } from '../common/fx.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { HouseholdAccountsService } from './household-accounts.service';
import { HouseholdNetWorthService } from './household-networth.service';
import { HouseholdCashflowService } from './household-cashflow.service';
import { HouseholdBudgetService } from './household-budget.service';
import { HouseholdDebtService } from './household-debt.service';

/** Current month as `YYYY-MM` (UTC). */
function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** SHA-256 hex over the canonical-JSON payload — the tamper-evidence checksum. */
function checksumOf(payload: FinancialSnapshotPayload): string {
  return createHash('sha256').update(canonicalStringify(payload)).digest('hex');
}

interface AccountRow {
  id: string;
  name: string;
  assetClass: string | null;
  entityId: string | null;
  currency: string;
  balanceMinor: number;
  isLiability: boolean;
}

/**
 * The Financial Snapshot seam (M2-6) — the canonical read model. It **composes**
 * M2-2..M2-5 (accounts, net worth, cashflow/budget, debt) into one immutable,
 * versioned, checksummed payload; it introduces no new aggregation math and never
 * re-aggregates raw tables beyond what those engines already compute (ADR-012). See
 * docs/architecture/M2_FINANCIAL_SNAPSHOT_CONTRACT.md.
 */
@Injectable()
export class HouseholdFinancialSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly audit: AuditService,
    private readonly accounts: HouseholdAccountsService,
    private readonly netWorth: HouseholdNetWorthService,
    private readonly cashflow: HouseholdCashflowService,
    private readonly budget: HouseholdBudgetService,
    private readonly debt: HouseholdDebtService,
  ) {}

  /**
   * Compose the live financial position into the contract payload (base currency).
   * Pure composition of the existing engines + core FX — no persistence.
   */
  private async compose(
    householdId: string,
    baseCurrency: string,
    period: string,
  ): Promise<{ payload: FinancialSnapshotPayload; provenance: Prisma.InputJsonValue }> {
    const base = baseCurrency as CurrencyCode;
    const toBase = (minor: number, from: string) =>
      convertMinor(minor, from as CurrencyCode, base, this.fx);

    const [accountRows, nw, cf, bud, debtSummary, activeDebts, memberCount, entityCount] =
      await Promise.all([
        this.accounts.list(householdId) as Promise<AccountRow[]>,
        this.netWorth.current(householdId, base),
        this.cashflow.summary(householdId, base, period),
        this.budget.getForMonth(householdId, base, period),
        this.debt.summary(householdId, base),
        this.prisma.debt.findMany({ where: { householdId, status: 'active' } }),
        this.prisma.householdMember.count({ where: { householdId } }),
        this.prisma.entity.count({ where: { householdId } }),
      ]);

    // Assets / liabilities (M2-2 accounts, converted to base).
    const assets = accountRows
      .filter((a) => !a.isLiability)
      .map((a) => ({
        accountId: a.id,
        name: a.name,
        assetClass: a.assetClass,
        entityId: a.entityId,
        nativeCurrency: a.currency,
        nativeBalanceMinor: a.balanceMinor,
        baseBalanceMinor: toBase(a.balanceMinor, a.currency),
      }));
    const liabilities = accountRows
      .filter((a) => a.isLiability)
      .map((a) => ({
        accountId: a.id,
        name: a.name,
        entityId: a.entityId,
        nativeCurrency: a.currency,
        nativeBalanceMinor: a.balanceMinor,
        baseBalanceMinor: toBase(a.balanceMinor, a.currency),
      }));

    const totalAssetsBase = assets.reduce((s, a) => s + a.baseBalanceMinor, 0);

    // Asset allocation (% of assets by class).
    const allocMap = new Map<string, number>();
    for (const a of assets) {
      const key = a.assetClass ?? 'unclassified';
      allocMap.set(key, (allocMap.get(key) ?? 0) + a.baseBalanceMinor);
    }
    const assetAllocation = [...allocMap.entries()]
      .map(([assetClass, baseValueMinor]) => ({
        assetClass,
        baseValueMinor,
        pct: totalAssetsBase > 0 ? Math.round((baseValueMinor / totalAssetsBase) * 1000) / 10 : 0,
      }))
      .sort((x, y) => y.baseValueMinor - x.baseValueMinor);

    // Currency exposure (gross, by native currency, assets + liabilities).
    const ccyMap = new Map<string, number>();
    for (const a of [...assets, ...liabilities]) {
      ccyMap.set(a.nativeCurrency, (ccyMap.get(a.nativeCurrency) ?? 0) + a.baseBalanceMinor);
    }
    const grossBase = [...ccyMap.values()].reduce((s, v) => s + v, 0);
    const currencyExposure = [...ccyMap.entries()]
      .map(([currency, baseValueMinor]) => ({
        currency,
        baseValueMinor,
        pct: grossBase > 0 ? Math.round((baseValueMinor / grossBase) * 1000) / 10 : 0,
      }))
      .sort((x, y) => y.baseValueMinor - x.baseValueMinor);

    // Entity holdings roll-up (accounts + active debts, by entityId).
    const entityMap = new Map<
      string | null,
      { assetsMinor: number; liabilitiesMinor: number; debtOutstandingMinor: number }
    >();
    const bucket = (key: string | null) => {
      let b = entityMap.get(key);
      if (!b) {
        b = { assetsMinor: 0, liabilitiesMinor: 0, debtOutstandingMinor: 0 };
        entityMap.set(key, b);
      }
      return b;
    };
    for (const a of assets) bucket(a.entityId).assetsMinor += a.baseBalanceMinor;
    for (const l of liabilities) bucket(l.entityId).liabilitiesMinor += l.baseBalanceMinor;
    for (const d of activeDebts) {
      const outstanding = d.outstandingMinor != null ? Number(d.outstandingMinor) : Number(d.principalMinor);
      bucket(d.entityId).debtOutstandingMinor += toBase(outstanding, d.currency);
    }
    const entityHoldings = [...entityMap.entries()]
      .map(([entityId, v]) => ({
        entityId,
        assetsMinor: v.assetsMinor,
        liabilitiesMinor: v.liabilitiesMinor,
        debtOutstandingMinor: v.debtOutstandingMinor,
        netMinor: v.assetsMinor - v.liabilitiesMinor - v.debtOutstandingMinor,
      }))
      .sort((x, y) => y.netMinor - x.netMinor);

    // Household equity reconciles M2-3 net worth with the M2-5 debt ledger (ADR-012).
    const reconciledEquityMinor = nw.netWorthMinor - debtSummary.totalOutstandingMinor;

    const payload: FinancialSnapshotPayload = {
      netWorth: {
        assetsMinor: nw.assetsMinor,
        liabilitiesMinor: nw.liabilitiesMinor,
        netWorthMinor: nw.netWorthMinor,
        solvencyRatio: nw.solvencyRatio,
      },
      assets,
      liabilities,
      debt: {
        totalOutstandingMinor: debtSummary.totalOutstandingMinor,
        totalMonthlyPaymentMinor: debtSummary.totalMonthlyPaymentMinor,
        weightedAvgRatePct: debtSummary.weightedAvgRatePct,
        debtCount: debtSummary.debtCount,
        byType: debtSummary.byType,
      },
      cashflowSummary: {
        period,
        incomeMinor: cf.income,
        expenseMinor: cf.expense,
        netMinor: cf.net,
        savingsRate: cf.savingsRate,
        byCategory: cf.byCategory,
      },
      budgetSummary: {
        period,
        exists: bud.exists,
        totalBudgetMinor: bud.totalBudgetMinor,
        totalSpentMinor: bud.totalSpentMinor,
        overTotal: bud.overTotal,
      },
      assetAllocation,
      currencyExposure,
      householdEquity: {
        netWorthMinor: nw.netWorthMinor,
        totalDebtMinor: debtSummary.totalOutstandingMinor,
        reconciledEquityMinor,
      },
      entityHoldings,
      relationships: {
        memberCount,
        entityCount,
        entityIds: [...new Set(accountRows.map((a) => a.entityId).filter((e): e is string => !!e))],
        accountIds: accountRows.map((a) => a.id),
      },
    };

    const provenance = {
      accountCount: accountRows.length,
      activeDebtCount: activeDebts.length,
      cashflowPeriod: period,
      netWorthCurrency: nw.currency,
    };

    return { payload, provenance };
  }

  /** The stable envelope + payload shape returned to callers. */
  private serialize(s: FinancialSnapshot) {
    return {
      id: s.id,
      householdId: s.householdId,
      entityId: s.entityId,
      capturedAt: s.capturedAt,
      snapshotVersion: s.snapshotVersion,
      schemaVersion: s.schemaVersion,
      engineVersion: s.engineVersion,
      fxVersion: s.fxVersion,
      currency: s.currency,
      generatedBy: s.generatedBy,
      checksum: s.checksum,
      status: s.status,
      provenance: s.provenance,
      payload: s.payload,
    };
  }

  /**
   * Live composed preview — the "what would a snapshot look like right now" view.
   * **Never persisted**; carries no id/checksum/status (it is not a snapshot).
   */
  async current(householdId: string, baseCurrency: string, period?: string) {
    const p = period ?? currentMonth();
    const { payload, provenance } = await this.compose(householdId, baseCurrency, p);
    return {
      live: true,
      capturedAt: new Date(),
      schemaVersion: FINANCIAL_SNAPSHOT_SCHEMA_VERSION,
      engineVersion: FINANCIAL_SNAPSHOT_ENGINE_VERSION,
      fxVersion: this.fx.version,
      currency: baseCurrency,
      provenance,
      payload,
    };
  }

  /** Capture an immutable snapshot of the current composed position. */
  async capture(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    baseCurrency: string,
    period?: string,
    ip?: string,
  ) {
    const p = period ?? currentMonth();
    const { payload, provenance } = await this.compose(householdId, baseCurrency, p);
    const checksum = checksumOf(payload);
    // Best-effort ordinal; capturedAt+id is the authoritative order.
    const count = await this.prisma.financialSnapshot.count({ where: { householdId } });

    const snap = await this.prisma.financialSnapshot.create({
      data: {
        householdId,
        firmId: firm.firmId,
        entityId: null,
        snapshotVersion: count + 1,
        schemaVersion: FINANCIAL_SNAPSHOT_SCHEMA_VERSION,
        engineVersion: FINANCIAL_SNAPSHOT_ENGINE_VERSION,
        fxVersion: this.fx.version,
        currency: baseCurrency,
        generatedBy: 'manual',
        createdById: actor.id,
        checksum,
        status: 'active',
        provenance: provenance,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.financial-snapshot.capture',
      entityType: 'FinancialSnapshot',
      entityId: snap.id,
      metadata: { firmId: firm.firmId, householdId, snapshotId: snap.id, checksum },
      ip,
    });
    return this.serialize(snap);
  }

  /** The latest active stored snapshot (null if none). */
  async latest(householdId: string) {
    const snap = await this.prisma.financialSnapshot.findFirst({
      where: { householdId, status: 'active' },
      orderBy: { capturedAt: 'desc' },
    });
    return snap ? this.serialize(snap) : null;
  }

  /** Envelope + headline figures per snapshot, oldest first (for trend charts). */
  async timeline(householdId: string) {
    const snaps = await this.prisma.financialSnapshot.findMany({
      where: { householdId },
      orderBy: { capturedAt: 'asc' },
    });
    return snaps.map((s) => {
      const p = s.payload as unknown as FinancialSnapshotPayload;
      return {
        id: s.id,
        capturedAt: s.capturedAt,
        snapshotVersion: s.snapshotVersion,
        schemaVersion: s.schemaVersion,
        currency: s.currency,
        status: s.status,
        netWorthMinor: p.netWorth?.netWorthMinor ?? 0,
        totalDebtMinor: p.debt?.totalOutstandingMinor ?? 0,
        savingsRate: p.cashflowSummary?.savingsRate ?? 0,
      };
    });
  }

  /** A specific stored snapshot (full payload), scoped to the household. */
  async getById(householdId: string, snapshotId: string) {
    const snap = await this.prisma.financialSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snap || snap.householdId !== householdId) return null;
    return this.serialize(snap);
  }
}
