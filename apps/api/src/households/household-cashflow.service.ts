import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Transaction } from '@prisma/client';
import {
  convertMinor,
  CurrencyCode,
  summarizeCashflow,
  type CashflowEntry,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { FxService } from '../common/fx.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import {
  CreateHouseholdTransactionDto,
  UpdateHouseholdTransactionDto,
} from './household-cashflow.dto';

/** Serialize a transaction row (BigInt money → number) for the API boundary. */
function serialize(t: Transaction) {
  return {
    id: t.id,
    householdId: t.householdId,
    firmId: t.firmId,
    accountId: t.accountId,
    type: t.type,
    category: t.category,
    amountMinor: Number(t.amountMinor),
    currency: t.currency,
    baseCurrency: t.baseCurrency,
    note: t.note,
    tags: t.tags,
    status: t.status,
    occurredAt: t.occurredAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** [start, end) UTC bounds for a `YYYY-MM` month string. */
function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end = new Date(Date.UTC(y!, m!, 1));
  return { start, end };
}

/** 'YYYY-MM' for a date (UTC). */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The household cashflow ledger (M2-4) — the single source of truth for household
 * financial activity. Every transaction is FX-converted to the household base
 * currency at aggregation (ADR-003); no converted amount is stored. Reused by the
 * budget engine (actuals) and future modules (M2-6 seam) via {@link summary}.
 */
@Injectable()
export class HouseholdCashflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly audit: AuditService,
  ) {}

  /** The account a transaction posts to must belong to the path household. */
  private async assertAccountInHousehold(householdId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.householdId !== householdId) {
      throw new BadRequestException('accountId is not an account of this household');
    }
  }

  /** Load a transaction and confirm it belongs to the path household. */
  private async owned(householdId: string, txId: string): Promise<Transaction> {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx || tx.householdId !== householdId) {
      throw new NotFoundException('Transaction not found');
    }
    return tx;
  }

  async list(householdId: string, month?: string) {
    const where: Prisma.TransactionWhereInput = { householdId };
    if (month) {
      const { start, end } = monthRange(month);
      where.occurredAt = { gte: start, lt: end };
    }
    const rows = await this.prisma.transaction.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
    });
    return rows.map(serialize);
  }

  async create(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    baseCurrency: string,
    dto: CreateHouseholdTransactionDto,
    ip?: string,
  ) {
    await this.assertAccountInHousehold(householdId, dto.accountId);
    const tx = await this.prisma.transaction.create({
      data: {
        householdId,
        firmId: firm.firmId,
        accountId: dto.accountId,
        type: dto.type as Prisma.TransactionCreateInput['type'],
        category: dto.category,
        amountMinor: BigInt(dto.amountMinor),
        currency: dto.currency ?? 'INR',
        baseCurrency,
        note: dto.note ?? null,
        tags: dto.tags ?? [],
        status: dto.status ?? 'cleared',
        occurredAt: new Date(dto.occurredAt),
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.cashflow.create',
      entityType: 'Transaction',
      entityId: tx.id,
      metadata: { firmId: firm.firmId, householdId, type: dto.type },
      ip,
    });
    return serialize(tx);
  }

  async update(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    txId: string,
    dto: UpdateHouseholdTransactionDto,
    ip?: string,
  ) {
    await this.owned(householdId, txId);
    const tx = await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        ...(dto.type !== undefined
          ? { type: dto.type as Prisma.TransactionUpdateInput['type'] }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.amountMinor !== undefined ? { amountMinor: BigInt(dto.amountMinor) } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.occurredAt !== undefined ? { occurredAt: new Date(dto.occurredAt) } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        updatedById: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.cashflow.update',
      entityType: 'Transaction',
      entityId: txId,
      metadata: { firmId: firm.firmId, householdId, fields: Object.keys(dto) },
      ip,
    });
    return serialize(tx);
  }

  async remove(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    txId: string,
    ip?: string,
  ) {
    await this.owned(householdId, txId);
    await this.prisma.transaction.delete({ where: { id: txId } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.cashflow.delete',
      entityType: 'Transaction',
      entityId: txId,
      metadata: { firmId: firm.firmId, householdId },
      ip,
    });
    return { ok: true };
  }

  /**
   * Convert a set of ledger rows to base-currency cashflow entries. `void` rows are
   * dropped; each amount is FX-converted individually before aggregation (ADR-003).
   */
  private toEntries(rows: Transaction[], base: CurrencyCode): CashflowEntry[] {
    return rows
      .filter((t) => t.status !== 'void')
      .map((t) => ({
        type: t.type as CashflowEntry['type'],
        amountMinor: convertMinor(
          Number(t.amountMinor),
          t.currency as CurrencyCode,
          base,
          this.fx,
        ),
        category: t.category,
      }));
  }

  /**
   * Reusable summary of a month's cashflow in the household base currency. The budget
   * engine (M2-4) and the financial-snapshot seam (M2-6) call this rather than
   * re-aggregating the ledger.
   */
  async summary(householdId: string, baseCurrency: string, month?: string) {
    const where: Prisma.TransactionWhereInput = { householdId };
    if (month) {
      const { start, end } = monthRange(month);
      where.occurredAt = { gte: start, lt: end };
    }
    const txns = await this.prisma.transaction.findMany({ where });
    const base = baseCurrency as CurrencyCode;
    const summary = summarizeCashflow(this.toEntries(txns, base), base);
    return {
      income: summary.income.minor,
      expense: summary.expense.minor,
      net: summary.net.minor,
      savingsRate: summary.savingsRate,
      byCategory: summary.byCategory,
      currency: base,
      ...(month ? { month } : {}),
    };
  }

  /**
   * Monthly cashflow timeline, oldest→newest, base-currency-normalized — ready for
   * trend charts. Complements the M2-3 net-worth timeline (flow vs stock).
   */
  async timeline(householdId: string, baseCurrency: string) {
    const base = baseCurrency as CurrencyCode;
    const txns = await this.prisma.transaction.findMany({
      where: { householdId },
      orderBy: { occurredAt: 'asc' },
    });
    const byMonth = new Map<string, Transaction[]>();
    for (const t of txns) {
      const key = monthKey(t.occurredAt);
      const bucket = byMonth.get(key) ?? [];
      bucket.push(t);
      byMonth.set(key, bucket);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, rows]) => {
        const s = summarizeCashflow(this.toEntries(rows, base), base);
        return {
          month,
          income: s.income.minor,
          expense: s.expense.minor,
          net: s.net.minor,
          savingsRate: s.savingsRate,
          byCategory: s.byCategory,
          currency: base,
        };
      });
  }

  /** Actual expense per category for a month (base currency) — feeds the budget engine. */
  async actualsByCategory(
    householdId: string,
    baseCurrency: string,
    month: string,
  ): Promise<Map<string, number>> {
    const { start, end } = monthRange(month);
    const txns = await this.prisma.transaction.findMany({
      where: { householdId, occurredAt: { gte: start, lt: end } },
    });
    const base = baseCurrency as CurrencyCode;
    const s = summarizeCashflow(this.toEntries(txns, base), base);
    return new Map(s.byCategory.map((c) => [c.category, c.amountMinor]));
  }
}
