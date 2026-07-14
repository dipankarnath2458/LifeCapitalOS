import { Injectable } from '@nestjs/common';
import { NetWorthSnapshot } from '@prisma/client';
import { computeNetWorth, convertMinor, CurrencyCode } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { FxService } from '../common/fx.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';

/** Public shape of an immutable net-worth snapshot (BigInt serialized). */
function serializeSnapshot(s: NetWorthSnapshot) {
  return {
    id: s.id,
    householdId: s.householdId,
    assetsMinor: Number(s.assetsMinor),
    liabilitiesMinor: Number(s.liabilitiesMinor),
    netWorthMinor: Number(s.netWorthMinor),
    currency: s.currency,
    capturedAt: s.capturedAt,
  };
}

@Injectable()
export class HouseholdNetWorthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Live consolidated net worth for a household, in its base currency. Each account is
   * FX-converted to the base currency individually (FX boundary — ADR-003) before the
   * pure `computeNetWorth` aggregation. Computed, never stored.
   */
  async current(householdId: string, baseCurrency: string) {
    const base = baseCurrency as CurrencyCode;
    const accounts = await this.prisma.account.findMany({ where: { householdId } });
    const converted = accounts.map((a) => ({
      balanceMinor: convertMinor(Number(a.balanceMinor), a.currency as CurrencyCode, base, this.fx),
      currency: base,
      isLiability: a.isLiability,
    }));
    const r = computeNetWorth(converted, base);
    return {
      assetsMinor: r.assets.minor,
      liabilitiesMinor: r.liabilities.minor,
      netWorthMinor: r.netWorth.minor,
      solvencyRatio: r.solvencyRatio,
      currency: base,
      accountCount: accounts.length,
    };
  }

  /** Capture an immutable snapshot of the current consolidated position. */
  async snapshot(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    baseCurrency: string,
    ip?: string,
  ) {
    const cur = await this.current(householdId, baseCurrency);
    const snap = await this.prisma.netWorthSnapshot.create({
      data: {
        householdId,
        firmId: firm.firmId,
        assetsMinor: BigInt(cur.assetsMinor),
        liabilitiesMinor: BigInt(cur.liabilitiesMinor),
        netWorthMinor: BigInt(cur.netWorthMinor),
        currency: cur.currency,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.networth.snapshot',
      entityType: 'NetWorthSnapshot',
      entityId: snap.id,
      metadata: { firmId: firm.firmId, householdId, netWorthMinor: cur.netWorthMinor },
      ip,
    });
    return serializeSnapshot(snap);
  }

  /** The household's net-worth history, oldest first. */
  async timeline(householdId: string) {
    const snaps = await this.prisma.netWorthSnapshot.findMany({
      where: { householdId },
      orderBy: { capturedAt: 'asc' },
    });
    return snaps.map(serializeSnapshot);
  }
}
