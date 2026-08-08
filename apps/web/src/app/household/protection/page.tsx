'use client';

/**
 * Protection — TEMPORARY migration surface. Replaced natively in M5.9.
 *
 * Hosts the preserved V1 `Protection` component unchanged. This is the ONLY working
 * protection capture in the product: the V2 dashboard's insurance panel reads
 * `assumptions.insurance`, which the intelligence controller never passes, so its
 * `coverTracked` is always false. M5.9 must build the data path, not just a form.
 */

import { Protection } from '@/components/Protection';
import { TemporarySurface } from '../TemporarySurface';

export default function ProtectionPage() {
  return (
    <TemporarySurface
      title="Your protection"
      description="Life and health cover, so we can tell you whether your family is protected."
      replacedBy="Module 5.9"
    >
      {(token) => <Protection token={token} />}
    </TemporarySurface>
  );
}
