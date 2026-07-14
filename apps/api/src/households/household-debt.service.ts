import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Debt, DebtPayment, DebtSnapshot, Prisma } from '@prisma/client';
import {
  convertMinor,
  CurrencyCode,
  simulateDebtPayoff,
  summarizeDebt,
  type DebtStrategy,
  type DebtSummaryEntry,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { FxService } from '../common/fx.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import {
  CreateDebtDto,
  RecordDebtPaymentDto,
  UpdateDebtDto,
} from './household-debt.dto';

/** Serialize a debt row (BigInt money → number) for the API boundary. */
function serializeDebt(d: Debt) {
  return {
    id: d.id,
    householdId: d.householdId,
    firmId: d.firmId,
    entityId: d.entityId,
    name: d.name,
    type: d.type,
    secured: d.secured,
    lender: d.lender,
    currency: d.currency,
    principalMinor: Number(d.principalMinor),
    outstandingMinor: d.outstandingMinor != null ? Number(d.outstandingMinor) : Number(d.principalMinor),
    annualInterestRatePct: d.annualInterestRatePct,
    minimumPaymentMinor: Number(d.minimumPaymentMinor),
    emiMinor: d.emiMinor != null ? Number(d.emiMinor) : null,
    status: d.status,
    startedAt: d.startedAt,
    maturityAt: d.maturityAt,
    dueDayOfMonth: d.dueDayOfMonth,
    note: d.note,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function serializePayment(p: DebtPayment) {
  return {
    id: p.id,
    debtId: p.debtId,
    type: p.type,
    amountMinor: Number(p.amountMinor),
    principalMinor: Number(p.principalMinor),
    interestMinor: Number(p.interestMinor),
    currency: p.currency,
    paidOn: p.paidOn,
    transactionId: p.transactionId,
    note: p.note,
    createdAt: p.createdAt,
  };
}

function serializeSnapshot(s: DebtSnapshot) {
  return {
    id: s.id,
    householdId: s.householdId,
    totalOutstandingMinor: Number(s.totalOutstandingMinor),
    totalEmiMinor: Number(s.totalEmiMinor),
    weightedAvgRatePct: s.weightedAvgRatePct,
    debtCount: s.debtCount,
    breakdown: s.breakdown,
    currency: s.currency,
    capturedAt: s.capturedAt,
  };
}

/** The current outstanding of a debt (falls back to principal when not yet set). */
function outstandingOf(d: Debt): number {
  return d.outstandingMinor != null ? Number(d.outstandingMinor) : Number(d.principalMinor);
}

/** The scheduled monthly obligation: explicit EMI if set, else the minimum payment. */
function monthlyPaymentOf(d: Debt): number {
  return d.emiMinor != null ? Number(d.emiMinor) : Number(d.minimumPaymentMinor);
}

/**
 * The household debt engine (M2-5) — a detailed liability ledger parallel to the M2-3
 * net-worth accounts (ADR-011). Reuses `@lcos/core` `summarizeDebt`/`simulateDebtPayoff`
 * and the M2-3 `FxService`; debt outstanding is FX-converted to the household base at
 * aggregation (ADR-003). Immutable `DebtSnapshot`s follow ADR-004.
 */
@Injectable()
export class HouseholdDebtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly audit: AuditService,
  ) {}

  /** An entity referenced by a debt must belong to the same household. */
  private async assertEntityInHousehold(householdId: string, entityId: string) {
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity || entity.householdId !== householdId) {
      throw new BadRequestException('entityId is not an entity of this household');
    }
  }

  /** Load a debt and confirm it belongs to the path household. */
  private async owned(householdId: string, debtId: string): Promise<Debt> {
    const debt = await this.prisma.debt.findUnique({ where: { id: debtId } });
    if (!debt || debt.householdId !== householdId) {
      throw new NotFoundException('Debt not found');
    }
    return debt;
  }

  async list(householdId: string, status?: string) {
    const where: Prisma.DebtWhereInput = { householdId };
    if (status) where.status = status as Prisma.DebtWhereInput['status'];
    const rows = await this.prisma.debt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serializeDebt);
  }

  async create(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    dto: CreateDebtDto,
    ip?: string,
  ) {
    if (dto.entityId) await this.assertEntityInHousehold(householdId, dto.entityId);
    const debt = await this.prisma.debt.create({
      data: {
        householdId,
        firmId: firm.firmId,
        entityId: dto.entityId ?? null,
        name: dto.name,
        type: dto.type as Prisma.DebtCreateInput['type'],
        secured: dto.secured ?? false,
        lender: dto.lender ?? null,
        currency: dto.currency ?? 'INR',
        principalMinor: BigInt(dto.principalMinor),
        outstandingMinor: BigInt(dto.outstandingMinor ?? dto.principalMinor),
        annualInterestRatePct: dto.annualInterestRatePct,
        minimumPaymentMinor: BigInt(dto.minimumPaymentMinor),
        emiMinor: dto.emiMinor != null ? BigInt(dto.emiMinor) : null,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
        maturityAt: dto.maturityAt ? new Date(dto.maturityAt) : null,
        dueDayOfMonth: dto.dueDayOfMonth ?? null,
        note: dto.note ?? null,
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.debt.create',
      entityType: 'Debt',
      entityId: debt.id,
      metadata: { firmId: firm.firmId, householdId, type: dto.type },
      ip,
    });
    return serializeDebt(debt);
  }

  async update(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    debtId: string,
    dto: UpdateDebtDto,
    ip?: string,
  ) {
    await this.owned(householdId, debtId);
    if (dto.entityId) await this.assertEntityInHousehold(householdId, dto.entityId);
    const debt = await this.prisma.debt.update({
      where: { id: debtId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.secured !== undefined ? { secured: dto.secured } : {}),
        ...(dto.lender !== undefined ? { lender: dto.lender } : {}),
        ...(dto.outstandingMinor !== undefined
          ? { outstandingMinor: BigInt(dto.outstandingMinor) }
          : {}),
        ...(dto.annualInterestRatePct !== undefined
          ? { annualInterestRatePct: dto.annualInterestRatePct }
          : {}),
        ...(dto.minimumPaymentMinor !== undefined
          ? { minimumPaymentMinor: BigInt(dto.minimumPaymentMinor) }
          : {}),
        ...(dto.emiMinor !== undefined ? { emiMinor: BigInt(dto.emiMinor) } : {}),
        ...(dto.status !== undefined
          ? { status: dto.status as Prisma.DebtUpdateInput['status'] }
          : {}),
        ...(dto.maturityAt !== undefined ? { maturityAt: new Date(dto.maturityAt) } : {}),
        ...(dto.dueDayOfMonth !== undefined ? { dueDayOfMonth: dto.dueDayOfMonth } : {}),
        ...(dto.entityId !== undefined ? { entityId: dto.entityId } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        updatedById: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.debt.update',
      entityType: 'Debt',
      entityId: debtId,
      metadata: { firmId: firm.firmId, householdId, fields: Object.keys(dto) },
      ip,
    });
    return serializeDebt(debt);
  }

  async remove(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    debtId: string,
    ip?: string,
  ) {
    await this.owned(householdId, debtId);
    await this.prisma.debt.delete({ where: { id: debtId } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.debt.delete',
      entityType: 'Debt',
      entityId: debtId,
      metadata: { firmId: firm.firmId, householdId },
      ip,
    });
    return { ok: true };
  }

  // --- Payments -------------------------------------------------------------

  async listPayments(householdId: string, debtId: string) {
    await this.owned(householdId, debtId);
    const rows = await this.prisma.debtPayment.findMany({
      where: { debtId },
      orderBy: { paidOn: 'desc' },
    });
    return rows.map(serializePayment);
  }

  /**
   * Record a repayment. The principal portion reduces the debt's outstanding (never
   * below zero); a foreclosure closes the debt. Reuses the M2-4 cashflow ledger via an
   * optional `transactionId` link — it does not duplicate transaction storage.
   */
  async recordPayment(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    debtId: string,
    dto: RecordDebtPaymentDto,
    ip?: string,
  ) {
    const debt = await this.owned(householdId, debtId);
    const type = dto.type ?? 'emi';
    const principalPortion = dto.principalMinor ?? dto.amountMinor - (dto.interestMinor ?? 0);
    const principal = Math.max(0, principalPortion);

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.debtPayment.create({
        data: {
          debtId,
          householdId,
          firmId: firm.firmId,
          type: type as Prisma.DebtPaymentCreateInput['type'],
          amountMinor: BigInt(dto.amountMinor),
          principalMinor: BigInt(principal),
          interestMinor: BigInt(dto.interestMinor ?? 0),
          currency: debt.currency,
          paidOn: new Date(dto.paidOn),
          transactionId: dto.transactionId ?? null,
          note: dto.note ?? null,
          createdById: actor.id,
        },
      });
      const currentOutstanding = outstandingOf(debt);
      const nextOutstanding =
        type === 'foreclosure' ? 0 : Math.max(0, currentOutstanding - principal);
      const updated = await tx.debt.update({
        where: { id: debtId },
        data: {
          outstandingMinor: BigInt(nextOutstanding),
          updatedById: actor.id,
          ...(type === 'foreclosure' || nextOutstanding === 0
            ? { status: 'closed' as Prisma.DebtUpdateInput['status'] }
            : {}),
        },
      });
      return { payment, updated };
    });

    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.debt.payment',
      entityType: 'Debt',
      entityId: debtId,
      metadata: { firmId: firm.firmId, householdId, type, amountMinor: dto.amountMinor },
      ip,
    });
    return { payment: serializePayment(result.payment), debt: serializeDebt(result.updated) };
  }

  // --- Aggregation (computed live; ADR-003) ---------------------------------

  /** Active debts converted to base-currency summary entries. */
  private async activeEntries(
    householdId: string,
    base: CurrencyCode,
  ): Promise<{ entries: DebtSummaryEntry[]; debts: Debt[] }> {
    const debts = await this.prisma.debt.findMany({
      where: { householdId, status: 'active' },
    });
    const entries = debts.map((d) => ({
      type: d.type,
      outstandingMinor: convertMinor(outstandingOf(d), d.currency as CurrencyCode, base, this.fx),
      monthlyPaymentMinor: convertMinor(
        monthlyPaymentOf(d),
        d.currency as CurrencyCode,
        base,
        this.fx,
      ),
      annualInterestRatePct: d.annualInterestRatePct,
    }));
    return { entries, debts };
  }

  /**
   * Live consolidated debt summary in the household base currency. Reusable by the
   * M2-6 seam (it calls this rather than re-aggregating).
   */
  async summary(householdId: string, baseCurrency: string) {
    const base = baseCurrency as CurrencyCode;
    const { entries } = await this.activeEntries(householdId, base);
    return summarizeDebt(entries, base);
  }

  /** Payoff projection (snowball/avalanche) over active debts, base currency. */
  async payoff(
    householdId: string,
    baseCurrency: string,
    strategy: DebtStrategy = 'avalanche',
    extraMonthlyMinor = 0,
  ) {
    const base = baseCurrency as CurrencyCode;
    const debts = await this.prisma.debt.findMany({
      where: { householdId, status: 'active' },
    });
    const inputs = debts.map((d) => ({
      id: d.id,
      name: d.name,
      principalMinor: convertMinor(outstandingOf(d), d.currency as CurrencyCode, base, this.fx),
      annualInterestRatePct: d.annualInterestRatePct,
      minimumPaymentMinor: convertMinor(
        Number(d.minimumPaymentMinor),
        d.currency as CurrencyCode,
        base,
        this.fx,
      ),
    }));
    const r = simulateDebtPayoff(inputs, extraMonthlyMinor, strategy, base);
    return {
      strategy: r.strategy,
      months: r.months,
      totalInterestMinor: r.totalInterestMinor,
      payoffOrder: r.payoffOrder,
      converged: r.converged,
      currency: base,
    };
  }

  // --- Snapshots (immutable; ADR-004) ---------------------------------------

  /** Capture an immutable snapshot of the current consolidated debt position. */
  async snapshot(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    baseCurrency: string,
    ip?: string,
  ) {
    const base = baseCurrency as CurrencyCode;
    const { entries, debts } = await this.activeEntries(householdId, base);
    const summary = summarizeDebt(entries, base);
    const breakdown = {
      byType: summary.byType,
      debts: debts.map((d, i) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        outstandingMinor: entries[i]?.outstandingMinor ?? 0,
        annualInterestRatePct: d.annualInterestRatePct,
      })),
    };
    const snap = await this.prisma.debtSnapshot.create({
      data: {
        householdId,
        firmId: firm.firmId,
        totalOutstandingMinor: BigInt(summary.totalOutstandingMinor),
        totalEmiMinor: BigInt(summary.totalMonthlyPaymentMinor),
        weightedAvgRatePct: summary.weightedAvgRatePct,
        debtCount: summary.debtCount,
        breakdown: breakdown as Prisma.InputJsonValue,
        currency: base,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.debt.snapshot',
      entityType: 'DebtSnapshot',
      entityId: snap.id,
      metadata: {
        firmId: firm.firmId,
        householdId,
        totalOutstandingMinor: summary.totalOutstandingMinor,
      },
      ip,
    });
    return serializeSnapshot(snap);
  }

  /** The household's debt-snapshot history, oldest first. */
  async timeline(householdId: string) {
    const snaps = await this.prisma.debtSnapshot.findMany({
      where: { householdId },
      orderBy: { capturedAt: 'asc' },
    });
    return snaps.map(serializeSnapshot);
  }
}
