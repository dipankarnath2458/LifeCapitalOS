'use client';

/**
 * "We could not find out" — the third state household resolution can return (Gap 7).
 *
 * Six consumer surfaces need to render this, so it lives here once. Duplicating it would invite
 * exactly the drift the bug came from: each page inventing its own answer to "what does a failed
 * lookup mean?", and five of them landing on "you have no household".
 *
 * ## Why this is not an onboarding invitation
 *
 * The family it is shown to very likely **has** a household. We simply could not confirm it —
 * most often because `/onboarding/status` is briefly rate limited. Offering "Get started" here
 * would tell someone with a complete financial picture to set it up again, which is the
 * `unknown → false` failure this component exists to prevent.
 *
 * ## Why the retry is a button and not a timer
 *
 * A 429 means the client has already asked too often. Retrying automatically would turn a rate
 * limit into a retry storm and delay the honest answer. The person chooses when to try again,
 * and by the time they do, the limiter's window has almost always rolled.
 *
 * The copy never names the status code or the endpoint: a family is owed an explanation they can
 * act on, not our internals. The distinction is preserved in the `reason` we are given, which is
 * what the calling page logs and what tests assert on.
 */

import { ErrorState } from '@/ui';
import { ThemedPage } from '@/components/ThemedPage';
import type { UnavailableReason } from '@/lib/household';

export function HouseholdUnavailable({
  reason,
  /** What the family was trying to reach, e.g. "your goals". Keeps the message specific. */
  subject,
  onRetry,
}: {
  reason?: UnavailableReason;
  subject: string;
  onRetry?: () => void;
}) {
  return (
    <ThemedPage>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <ErrorState
          title="We could not load this just now"
          description={
            reason === 'rate-limited'
              ? `Things are busy at our end, so we could not fetch ${subject}. Nothing is wrong with your account — please try again in a moment.`
              : `We could not reach us to fetch ${subject}. Please check your connection and try again.`
          }
          action={{
            label: 'Try again',
            onClick: onRetry ?? (() => window.location.reload()),
          }}
          className="mb-4"
        />
        <div data-testid="household-unavailable" data-reason={reason ?? 'network'} />
      </main>
    </ThemedPage>
  );
}
