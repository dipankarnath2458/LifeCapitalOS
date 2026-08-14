'use client';

/**
 * Your protection — native V2 surface (M5.9).
 *
 * Design: `docs/M5_9_PROTECTION_ARCHITECTURE.md`.
 *
 * Replaces the temporary surface that mounted V1's `Protection` component. That component wrote
 * the retail `Profile` — a store the V2 intelligence layer does not read — so a family could fill
 * it in and change **no figure anywhere**. This one writes `HouseholdMember`, the table the layer
 * now reads, and asks each person separately, because a spouse's cover is a different fact from
 * yours and one `Profile` row cannot hold both.
 *
 * V1's `Protection` component stays on `/dashboard`, untouched, as the safety net.
 *
 * ## Three states, not two
 *
 * Every answer is **unknown / yes / no**. "Not answered yet" is a real option a family can see,
 * because the alternative — defaulting to "no" — is what told every household in the product
 * that it had no insurance. Leaving a question unanswered saves nothing for that field; it never
 * overwrites an answer already given.
 *
 * Composed entirely from the frozen design system.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/session';
import { resolveHouseholdId } from '@/lib/household';
import {
  loadProtection,
  saveMemberProtection,
  type MemberProtection,
  type ProtectionOverview,
} from '@/lib/householdProtection';
import { formatMoney } from '@/lib/intelligence';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Heading,
  LabeledInput,
  LoadingState,
  Select,
  Text,
} from '@/ui';
import { ThemedPage } from '@/components/ThemedPage';

/** The three states a protection answer can be in, as the family sees them. */
const UNKNOWN = 'unknown';
const answerOf = (v: boolean | null) => (v === null ? UNKNOWN : v ? 'yes' : 'no');
/** `undefined` means "send nothing for this field", which leaves the stored answer alone. */
const toAnswer = (v: string): boolean | undefined => (v === UNKNOWN ? undefined : v === 'yes');

function AnswerSelect({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <div>
      <Text muted className="mb-1 block text-xs">
        {label}
      </Text>
      <Select
        aria-label={label}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={UNKNOWN}>Not answered yet</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </Select>
    </div>
  );
}

interface Draft {
  term: string;
  health: string;
  cover: string;
}

const draftOf = (m: MemberProtection): Draft => ({
  term: answerOf(m.hasTermCover),
  health: answerOf(m.hasHealthInsurance),
  cover: m.termLifeCoverMinor === null ? '' : String(m.termLifeCoverMinor / 100),
});

export default function ProtectionPage() {
  const [token, setToken] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [overview, setOverview] = useState<ProtectionOverview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async (t: string, id: string) => {
    try {
      const data = await loadProtection(t, id);
      setOverview(data);
      // Rebuild drafts from the server's answers. Safe because this only runs on load and
      // immediately after a save, never while a field is being edited.
      setDrafts(Object.fromEntries(data.members.map((m) => [m.memberId, draftOf(m)])));
      setError(null);
    } catch {
      setError('load');
    }
  }, []);

  useEffect(() => {
    const t = getAccessToken();
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
    void resolveHouseholdId(t).then((id) => {
      if (!id) {
        setError('needs-onboarding');
        return;
      }
      setHouseholdId(id);
      return load(t, id);
    });
  }, [load]);

  async function save(m: MemberProtection) {
    const draft = drafts[m.memberId];
    if (!token || !householdId || !draft || busy) return;
    setBusy(m.memberId);
    setError(null);
    try {
      const term = toAnswer(draft.term);
      await saveMemberProtection(token, householdId, m.memberId, {
        ...(term !== undefined ? { hasTermCover: term } : {}),
        ...(toAnswer(draft.health) !== undefined
          ? { hasHealthInsurance: toAnswer(draft.health) }
          : {}),
        // The amount only means anything alongside a "yes"; a stated "no" records zero cover.
        ...(term === true ? { termLifeCoverMinor: Math.round((parseFloat(draft.cover) || 0) * 100) } : {}),
        ...(term === false ? { termLifeCoverMinor: 0 } : {}),
      });
      await load(token, householdId);
      setSaved(m.memberId);
      setTimeout(() => setSaved(null), 2500);
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }

  const patch = (id: string, part: Partial<Draft>) =>
    setDrafts((d) => {
      const current = d[id];
      if (!current) return d;
      return { ...d, [id]: { ...current, ...part } };
    });

  if (!token || (overview === null && error === null)) {
    return (
      <ThemedPage>
        <LoadingState label="Loading your protection…" />
      </ThemedPage>
    );
  }

  if (error === 'needs-onboarding') {
    return (
      <ThemedPage>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <EmptyState
            title="Let's set up your household first"
            description="Your protection belongs to your household, so we need that before anything else."
            action={{ label: 'Get started', onClick: () => (window.location.href = '/onboarding') }}
          />
        </main>
      </ThemedPage>
    );
  }

  const members = overview?.members ?? [];

  return (
    <ThemedPage>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={1} className="text-2xl">
              Your protection
            </Heading>
            <Text muted className="mt-1 block text-sm">
              Life and health cover, person by person, so we can tell you whether your family is
              protected.
            </Text>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/household')}>
            Back to dashboard
          </Button>
        </div>

        {error === 'load' && <ErrorState description="We could not load your protection just now." />}
        {error === 'save' && (
          <ErrorState description="We could not save that. Please check the details and try again." />
        )}

        {/* The household's position, or an honest statement that we cannot give one yet. A
            partly-answered family gets no assessment, because a gap computed from half a
            household is exactly the fabrication this milestone removes. */}
        <Card className="mb-6">
          <CardContent>
            {overview?.coverTracked && overview.summary ? (
              <div data-testid="protection-summary">
                <Heading level={2} className="mb-2 text-base">
                  Your family's cover
                </Heading>
                <Text className="block text-sm">
                  Total life cover {formatMoney(overview.summary.existingCoverMinor)}.{' '}
                  {overview.summary.hasHealthInsurance
                    ? 'Everyone has health cover.'
                    : 'Someone in your family has no health cover.'}
                </Text>
                <Text muted className="mt-1 block text-xs">
                  Your dashboard now assesses protection against these answers.
                </Text>
              </div>
            ) : (
              <div data-testid="protection-incomplete">
                <Heading level={2} className="mb-2 text-base">
                  We can't assess your protection yet
                </Heading>
                <Text muted className="block text-sm">
                  {overview?.unansweredMemberIds.length === members.length
                    ? 'Answer the questions below and your dashboard will start assessing your cover.'
                    : 'A few answers are still missing. Until everyone has answered we would only be guessing, so your dashboard says nothing about protection rather than something wrong.'}
                </Text>
              </div>
            )}
          </CardContent>
        </Card>

        {members.length === 0 ? (
          <EmptyState
            title="No one in your family yet"
            description="Add your family first, then tell us how each person is covered."
            action={{
              label: 'Add my family',
              onClick: () => (window.location.href = '/household/family'),
            }}
          />
        ) : (
          <div className="space-y-3" data-testid="protection-list">
            {members.map((m) => {
              const draft = drafts[m.memberId];
              if (!draft) return null;
              return (
                <Card key={m.memberId}>
                  <CardContent>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Text className="font-medium">{m.name ?? 'This person'}</Text>
                      <Badge>{m.relation}</Badge>
                      {m.unanswered.length > 0 && (
                        <Badge tone="warning" data-testid="member-unanswered">
                          not answered
                        </Badge>
                      )}
                      {saved === m.memberId && <Badge tone="success">Saved</Badge>}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <AnswerSelect
                        label="Has health cover"
                        value={draft.health}
                        onChange={(v) => patch(m.memberId, { health: v })}
                        testId={`health-${m.memberId}`}
                      />
                      {/* Term cover is asked of adults only: a child's own life policy is not
                          what replaces the household's income, and the layer ignores it. */}
                      {!m.isDependent && (
                        <AnswerSelect
                          label="Has term life cover"
                          value={draft.term}
                          onChange={(v) => patch(m.memberId, { term: v })}
                          testId={`term-${m.memberId}`}
                        />
                      )}
                      {!m.isDependent && draft.term === 'yes' && (
                        <LabeledInput
                          label="Life cover amount (₹)"
                          type="number"
                          value={draft.cover}
                          onChange={(e) => patch(m.memberId, { cover: e.target.value })}
                        />
                      )}
                    </div>

                    <div className="mt-4">
                      <Button
                        size="sm"
                        onClick={() => void save(m)}
                        disabled={busy === m.memberId}
                        data-testid={`save-${m.memberId}`}
                      >
                        Save
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </ThemedPage>
  );
}
