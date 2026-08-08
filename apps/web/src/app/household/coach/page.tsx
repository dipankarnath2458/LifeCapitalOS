'use client';

/**
 * AI Coach — TEMPORARY migration surface. Replaced natively in M5.7.
 *
 * Hosts the preserved V1 `WealthCoach` and `SecondOpinion` components unchanged. Both
 * ground on the V1 retail scorer, which stays operational until its V2 replacement is
 * fully verified.
 */

import { WealthCoach } from '@/components/WealthCoach';
import { SecondOpinion } from '@/components/SecondOpinion';
import { TemporarySurface } from '../TemporarySurface';

export default function CoachPage() {
  return (
    <TemporarySurface
      title="Your AI coach"
      description="Ask about your finances, or get a second opinion on where you stand."
      replacedBy="Module 5.7"
    >
      {(token) => (
        <div className="space-y-6">
          <WealthCoach token={token} />
          <SecondOpinion token={token} />
        </div>
      )}
    </TemporarySurface>
  );
}
