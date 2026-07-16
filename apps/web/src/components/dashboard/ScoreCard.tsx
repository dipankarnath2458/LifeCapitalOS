'use client';

import type { ReactNode } from 'react';
import { Card, CardContent, Badge, Text, type BadgeTone } from '@/ui';

/**
 * Reusable score card — the single extension seam for every Capital Health score
 * (asset allocation, risk, emergency fund, retirement, insurance …). A future score
 * engine swaps `status="coming_soon"` for a live `value`/`band` with **no layout
 * change**. Presentation-only; composes `@/ui`. Accessible: the pending state is
 * conveyed in text, not colour alone.
 */
export interface ScoreCardProps {
  title: string;
  icon?: ReactNode;
  /** Live score value (e.g. 72 or "72"). Omit for the pending/placeholder state. */
  value?: ReactNode;
  /** Suffix shown after the value, e.g. "/ 100". */
  unit?: string;
  /** Qualitative band, e.g. "Good". */
  band?: string;
  bandTone?: BadgeTone;
  /** Small helper line under the value. */
  hint?: string;
  description?: string;
  /** "live" renders the value; "coming_soon" (default) renders the placeholder. */
  status?: 'live' | 'coming_soon';
}

export function ScoreCard({
  title,
  icon,
  value,
  unit,
  band,
  bandTone = 'neutral',
  hint,
  description,
  status = 'coming_soon',
}: ScoreCardProps) {
  const pending = status !== 'live' || value === undefined || value === null;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon && <span className="text-subtle" aria-hidden>{icon}</span>}
            <span className="text-sm font-medium text-foreground">{title}</span>
          </div>
          {pending ? (
            <Badge tone="neutral" variant="outline">
              Coming soon
            </Badge>
          ) : band ? (
            <Badge tone={bandTone}>{band}</Badge>
          ) : null}
        </div>

        {pending ? (
          <div>
            <div
              className="text-3xl font-semibold text-subtle/40"
              aria-label={`${title} score not available yet`}
            >
              — <span className="text-base">{unit ?? '/ 100'}</span>
            </div>
            <Text muted className="text-xs">
              {description ?? 'Score engine arrives in a future release.'}
            </Text>
          </div>
        ) : (
          <div>
            <div className="text-3xl font-semibold text-foreground">
              {value}
              {unit && <span className="ml-1 text-base font-normal text-subtle">{unit}</span>}
            </div>
            {hint && (
              <Text muted className="text-xs">
                {hint}
              </Text>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
