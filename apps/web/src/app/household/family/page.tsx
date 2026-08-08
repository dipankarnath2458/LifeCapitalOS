'use client';

/**
 * Family — TEMPORARY migration surface. Replaced natively in M5.8.
 * Hosts the preserved V1 `Family` component unchanged; see `./TemporarySurface.tsx`.
 *
 * Dependants recorded here feed the insurance-need calculation, so this is not cosmetic.
 */

import { Family } from '@/components/Family';
import { TemporarySurface } from '../TemporarySurface';

export default function FamilyPage() {
  return (
    <TemporarySurface
      title="Your family"
      description="Who you're planning for. Dependants affect how much cover you need."
      replacedBy="Module 5.8"
    >
      {(token) => <Family token={token} />}
    </TemporarySurface>
  );
}
