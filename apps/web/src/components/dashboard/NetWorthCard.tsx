'use client';

import { Card, CardContent, Text } from '@/ui';
import { IconWallet } from '@/ui/icons';

export interface NetWorth {
  netWorthMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  currency: string;
}

/** Presentation-only money formatting. Never used to compute or convert. */
function fmt(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toLocaleString()} ${currency}`;
  }
}

/** Section 1 — the one LIVE headline metric (consumes M2-3 /net-worth/current). */
export function NetWorthCard({ netWorth }: { netWorth: NetWorth | null }) {
  return (
    <Card className="ring-1 ring-primary/30">
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <IconWallet className="h-5 w-5 text-primary" aria-hidden />
          <span className="text-sm font-medium text-foreground">Net worth</span>
        </div>
        {netWorth ? (
          <>
            <div className="text-4xl font-bold text-foreground">
              {fmt(netWorth.netWorthMinor, netWorth.currency)}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <Text muted>
                Assets <span className="font-medium text-foreground">{fmt(netWorth.assetsMinor, netWorth.currency)}</span>
              </Text>
              <Text muted>
                Liabilities <span className="font-medium text-foreground">{fmt(netWorth.liabilitiesMinor, netWorth.currency)}</span>
              </Text>
            </div>
          </>
        ) : (
          <>
            <div className="text-4xl font-bold text-subtle/40">—</div>
            <Text muted className="text-sm">
              Add accounts to this family to see consolidated net worth.
            </Text>
          </>
        )}
      </CardContent>
    </Card>
  );
}
