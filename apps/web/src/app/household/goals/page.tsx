'use client';

/**
 * Goals — TEMPORARY migration surface. Replaced natively in M5.8.
 * Hosts the preserved V1 `Goals` component unchanged; see `./TemporarySurface.tsx`.
 */

import { Goals } from '@/components/Goals';
import { TemporarySurface } from '../TemporarySurface';

export default function GoalsPage() {
  return (
    <TemporarySurface
      title="Your goals"
      description="What you're saving towards, and the monthly amount each goal needs."
      replacedBy="Module 5.8"
    >
      {(token) => <Goals token={token} />}
    </TemporarySurface>
  );
}
