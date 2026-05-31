import { Injectable } from '@nestjs/common';
import { computeNetWorth, CurrencyCode } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NetWorthService {
  constructor(private readonly prisma: PrismaService) {}

  private async baseCurrency(userId: string): Promise<CurrencyCode> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    return (profile?.baseCurrency as CurrencyCode) ?? 'INR';
  }

  /** Live net-worth computed from current accounts (the Family Balance Sheet). */
  async current(userId: string) {
    const accounts = await this.prisma.account.findMany({ where: { userId } });
    const currency = await this.baseCurrency(userId);
    const result = computeNetWorth(
      accounts.map((a) => ({
        balanceMinor: Number(a.balanceMinor),
        currency: a.currency as CurrencyCode,
        isLiability: a.isLiability,
      })),
      currency,
    );
    return {
      assetsMinor: result.assets.minor,
      liabilitiesMinor: result.liabilities.minor,
      netWorthMinor: result.netWorth.minor,
      solvencyRatio: result.solvencyRatio,
      currency,
    };
  }

  /** Capture a snapshot for the net-worth timeline. */
  async snapshot(userId: string) {
    const current = await this.current(userId);
    const snap = await this.prisma.netWorthSnapshot.create({
      data: {
        userId,
        assetsMinor: BigInt(current.assetsMinor),
        liabilitiesMinor: BigInt(current.liabilitiesMinor),
        netWorthMinor: BigInt(current.netWorthMinor),
        currency: current.currency,
      },
    });
    return { ...current, id: snap.id, capturedAt: snap.capturedAt };
  }

  async timeline(userId: string) {
    const snaps = await this.prisma.netWorthSnapshot.findMany({
      where: { userId },
      orderBy: { capturedAt: 'asc' },
    });
    return snaps.map((s) => ({
      id: s.id,
      assetsMinor: Number(s.assetsMinor),
      liabilitiesMinor: Number(s.liabilitiesMinor),
      netWorthMinor: Number(s.netWorthMinor),
      currency: s.currency,
      capturedAt: s.capturedAt,
    }));
  }
}
