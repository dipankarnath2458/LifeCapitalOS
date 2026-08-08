'use client';

/**
 * A **temporary migration surface**: a V1 capability component hosted inside the V2 shell
 * while its native V2 replacement is built.
 *
 * ## Why these exist
 *
 * V2 became the primary consumer experience before every V1 capability had a V2
 * equivalent. Goals, Family, Protection and the AI Coach have none yet. Two options were
 * rejected:
 *
 *  - **Drop them.** That silently removes real functionality from consumers.
 *  - **Link consumers back to `/dashboard`.** V1 reads retail (`Account.userId`) data while
 *    V2 writes household (`Account.householdId`) data, so a consumer with ₹20,00,000 in V2
 *    sees **₹0** on a page headed "Your Family Balance Sheet". That is a confidently wrong
 *    number about someone's own net worth.
 *
 * So the *same* V1 components are mounted here instead — reused, never reimplemented, and
 * never edited. Only the capability panels are mounted; the balance-sheet panels that would
 * misreport are deliberately not, because V2 already replaces those.
 *
 * `/dashboard` itself remains deployed and functional as the rollback path.
 *
 * ## These are scheduled for removal
 *
 * Each route names its replacement module. When the native V2 version ships, the import on
 * that route is swapped and the URL never changes. See
 * `docs/V2_PRIMARY_MIGRATION_PLAN.md` §F.
 *
 * The V1 components carry V1 styling, so these pages look different from the rest of V2.
 * That seam is deliberate and temporary — it is the cost of not removing capability.
 */

import { useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/session';
import { Button, Heading, LoadingState, Text, ThemeProvider, ThemeScript } from '@/ui';

export function TemporarySurface({
  title,
  description,
  replacedBy,
  children,
}: {
  title: string;
  description: string;
  /** The module that will replace this surface — surfaced in the UI, not just in docs. */
  replacedBy: string;
  children: (token: string) => React.ReactNode;
}) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = getAccessToken();
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
  }, []);

  if (!token) {
    return (
      <ThemeProvider>
        <ThemeScript />
        <LoadingState label="Loading…" />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ThemeScript />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={1} className="text-2xl">
              {title}
            </Heading>
            <Text muted className="mt-1 block text-sm">
              {description}
            </Text>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/household')}>
            Back to dashboard
          </Button>
        </div>

        {/* Marks the surface as temporary for anyone reading the product, not only the repo.
            `replacedBy` is rendered so the roadmap commitment is visible, not buried. */}
        <div
          className="mb-6 rounded-card border border-border bg-muted/40 px-4 py-3"
          data-testid="temporary-surface-notice"
        >
          <Text muted className="block text-xs">
            We&apos;re rebuilding this part of Life Capital OS. Everything here works and your data
            is safe — it will move into the new experience in {replacedBy}.
          </Text>
        </div>

        {children(token)}
      </main>
    </ThemeProvider>
  );
}
