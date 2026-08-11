'use client';

/**
 * Family CFO (M5.7) — the native V2 AI surface.
 *
 * Design: `docs/M5_7_AI_INSIGHTS_ARCHITECTURE.md`.
 *
 * Replaces the temporary surface that hosted V1's `WealthCoach` and `SecondOpinion`. Those
 * components are untouched and still reachable on `/dashboard`; they simply are not what a
 * consumer is routed to any more, because they ground on retail (`Account.userId`) data that a
 * V2 consumer does not have — which made the coach narrate ₹0 to a family with ₹20,00,000.
 *
 * Three properties this page holds:
 *
 *  1. **No arithmetic.** The prose and the ranked actions both arrive composed from the server.
 *     The page renders strings; it derives no figure. Same rule as the dashboard.
 *  2. **Provenance is shown, never implied.** Every answer names the snapshot it came from, and
 *     an answer produced without a model is labelled as such. Presenting a deterministic template
 *     as personalised AI advice would be a lie about provenance.
 *  3. **Absence is a state.** No snapshot means "run your check", never a confident narrative
 *     about an empty balance sheet.
 */

import { useEffect, useRef, useState } from 'react';
import {
  askCoach,
  loadInsights,
  NotEntitledError,
  type AiAnswer,
  type CoachMessage,
  type RecommendedAction,
} from '@/lib/familyCfo';
import { getAccessToken } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Heading,
  Input,
  LoadingState,
  Text,
} from '@/ui';
import { ThemedPage } from '@/components/ThemedPage';

type Screen =
  | { kind: 'loading' }
  | { kind: 'ready'; answer: Extract<AiAnswer, { available: true }> }
  | { kind: 'needs-check'; reason: string }
  | { kind: 'error' };

/** A turn in the visible conversation. `ai: false` turns are labelled in the UI. */
interface Turn {
  role: 'user' | 'assistant';
  content: string;
  ai?: boolean;
}

function Actions({ actions }: { actions: RecommendedAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="cfo-actions">
      <Heading level={2} className="text-sm font-semibold uppercase tracking-wide">
        What to do next
      </Heading>
      {/* Ranked by the engine. The order is a finding, not a presentation choice, so it is
          rendered as given rather than re-sorted here. */}
      {actions.map((a) => (
        <Card key={`${a.sourceSection}-${a.priority}-${a.title}`}>
          <CardContent className="space-y-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <Text className="font-medium">{a.title}</Text>
              <Badge tone={a.estimatedImpact === 'high' ? 'warning' : 'neutral'}>
                {a.estimatedImpact} impact
              </Badge>
            </div>
            <Text muted className="block text-sm">
              {a.rationale}
            </Text>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function CoachPage() {
  const [token, setToken] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [locked, setLocked] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = getAccessToken();
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
    loadInsights(t)
      .then((res) => {
        if (!res) return setScreen({ kind: 'needs-check', reason: 'no household yet' });
        if (!res.available) return setScreen({ kind: 'needs-check', reason: res.reason });
        setScreen({ kind: 'ready', answer: res });
      })
      .catch(() => setScreen({ kind: 'error' }));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length]);

  async function ask() {
    const question = draft.trim();
    if (!token || !question || asking) return;
    setDraft('');
    const history: CoachMessage[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: question },
    ];
    setTurns((prev) => [...prev, { role: 'user', content: question }]);
    setAsking(true);
    try {
      const res = await askCoach(token, history);
      if (res?.available) {
        setTurns((prev) => [...prev, { role: 'assistant', content: res.answer, ai: res.ai }]);
      }
    } catch (err) {
      // Not entitled is not an error state: the summary above is still theirs to read, so the
      // page keeps working and offers the upgrade instead of replacing itself with a failure.
      if (err instanceof NotEntitledError) setLocked(true);
      else
        setTurns((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'Something went wrong reaching your coach. Please try again in a moment.',
            ai: false,
          },
        ]);
    } finally {
      setAsking(false);
    }
  }

  if (screen.kind === 'loading') {
    return (
      <ThemedPage>
        <LoadingState label="Reading your finances…" />
      </ThemedPage>
    );
  }

  return (
    <ThemedPage>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={1} className="text-2xl">
              Your Family CFO
            </Heading>
            <Text muted className="mt-1 block text-sm">
              Grounded in the same figures as your dashboard — never a guess.
            </Text>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/household')}>
            Back to dashboard
          </Button>
        </div>

        {screen.kind === 'error' && (
          <ErrorState
            title="We couldn’t load your position"
            description="Your data is safe. Please try again in a moment."
          />
        )}

        {screen.kind === 'needs-check' && (
          <EmptyState
            title="Run your Wealth Health Check first"
            description={`Your coach reads the same snapshot as your dashboard, and there isn’t one yet (${screen.reason}).`}
            action={{
              label: 'Start my check',
              onClick: () => (window.location.href = '/wealth-health'),
            }}
          />
        )}

        {screen.kind === 'ready' && (
          <div className="space-y-8">
            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-3 p-5">
                  {screen.answer.answer.split('\n').map((line, i) =>
                    line.trim() === '' ? null : (
                      <Text key={i} className="block" data-testid={i === 0 ? 'cfo-headline' : undefined}>
                        {line}
                      </Text>
                    ),
                  )}
                </CardContent>
              </Card>
              {/* Provenance, stated rather than implied — the same discipline as the dashboard. */}
              <Text muted className="block text-xs" data-testid="cfo-provenance">
                {screen.answer.ai
                  ? 'Written by your AI coach from your latest snapshot'
                  : 'Summary generated from your latest snapshot'}
                {screen.answer.capturedAt
                  ? ` · captured ${new Date(screen.answer.capturedAt).toLocaleDateString('en-IN')}`
                  : ''}
              </Text>
            </section>

            <Actions actions={screen.answer.actions} />

            <section className="space-y-4">
              <Heading level={2} className="text-sm font-semibold uppercase tracking-wide">
                Ask a question
              </Heading>

              {turns.length > 0 && (
                <div className="space-y-3" data-testid="cfo-conversation">
                  {turns.map((t, i) => (
                    <Card key={i} variant={t.role === 'user' ? 'muted' : 'default'}>
                      <CardContent className="space-y-1 p-4">
                        <Text className="block whitespace-pre-wrap">{t.content}</Text>
                        {t.role === 'assistant' && t.ai === false && (
                          <Text muted className="block text-xs">
                            Generated from your snapshot, not by the AI coach.
                          </Text>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  <div ref={endRef} />
                </div>
              )}

              {locked ? (
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <Text className="font-medium">Conversation is a Premium feature</Text>
                    <Text muted className="block text-sm">
                      Your summary and next steps above are always free. Upgrade to ask your coach
                      questions about your own numbers.
                    </Text>
                    <Button size="sm" onClick={() => (window.location.href = '/billing')}>
                      See plans
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask();
                  }}
                >
                  <Input
                    aria-label="Ask your Family CFO"
                    placeholder="Can I afford to retire at 55?"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={asking}
                  />
                  <Button type="submit" disabled={asking || draft.trim() === ''}>
                    {asking ? 'Thinking…' : 'Ask'}
                  </Button>
                </form>
              )}
            </section>
          </div>
        )}
      </main>
    </ThemedPage>
  );
}
