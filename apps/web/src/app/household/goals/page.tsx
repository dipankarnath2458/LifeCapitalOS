'use client';

/**
 * Your goals — native V2 surface (M5.8 PR 2).
 *
 * Design: `docs/M5_8_GOALS_CHARTS_ARCHITECTURE.md`.
 *
 * Replaces the temporary surface that mounted V1's `Goals` component. Goals are now
 * household-scoped: the family's goals, alongside everything else they own. `Goal` already carried
 * `householdId` and `firmId` from M1b, so this needed an API rather than a schema change.
 *
 * V1's `Goals` component stays on `/dashboard`, untouched, as the safety net.
 *
 * **A goal moves no figure.** The Financial Snapshot has no goals section, so nothing here changes
 * the dashboard, the score or the AI grounding. That gap is deliberate and documented; see §3 of
 * the design note.
 *
 * Composed entirely from the frozen design system.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/session';
import {
  addGoal,
  goalStanding,
  GOAL_TYPES,
  listGoals,
  removeGoal,
  resolveHouseholdId,
  updateGoal,
  type HouseholdGoal,
} from '@/lib/householdGoals';
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

// 'custom' is the enum's catch-all; there is no 'other'.
const BLANK = { name: '', type: 'custom', target: '', saved: '', targetDate: '' };

/** Rupees as typed → minor units. The only unit conversion this page performs. */
const toMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);

/**
 * Tone for a goal's standing. Text carries the meaning; colour only reinforces it — the same
 * accessibility rule M4 set for the pending score state.
 */
const STANDING_TONE: Record<'good' | 'watch' | 'bad', string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  watch: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
};

export default function GoalsPage() {
  const [token, setToken] = useState<string | null>(null);
  /** Resolved once on mount, then passed to every call. See the note in `lib/householdGoals`. */
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [goals, setGoals] = useState<HouseholdGoal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState<HouseholdGoal | null>(null);

  const load = useCallback(async (t: string, id: string) => {
    try {
      setGoals(await listGoals(t, id));
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

  async function submit() {
    if (!token || !householdId || !form.name.trim() || !form.targetDate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: form.name.trim(),
        type: form.type,
        targetAmountMinor: toMinor(form.target),
        currentAmountMinor: toMinor(form.saved),
        targetDate: new Date(form.targetDate).toISOString(),
      };
      if (editing) await updateGoal(token, householdId, editing.id, input);
      else await addGoal(token, householdId, input);
      setForm(BLANK);
      setEditing(null);
      await load(token, householdId);
    } catch {
      setError('save');
    } finally {
      setBusy(false);
    }
  }

  async function remove(goal: HouseholdGoal) {
    if (!token || !householdId || busy) return;
    setBusy(true);
    try {
      await removeGoal(token, householdId, goal.id);
      await load(token, householdId);
    } catch {
      setError('save');
    } finally {
      setBusy(false);
    }
  }

  function edit(goal: HouseholdGoal) {
    setEditing(goal);
    setForm({
      name: goal.name,
      type: goal.type,
      target: String(goal.targetAmountMinor / 100),
      saved: String(goal.currentAmountMinor / 100),
      targetDate: goal.targetDate.slice(0, 10),
    });
  }

  if (!token || (goals === null && error === null)) {
    return (
      <ThemedPage>
        <LoadingState label="Loading your goals…" />
      </ThemedPage>
    );
  }

  if (error === 'needs-onboarding') {
    return (
      <ThemedPage>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <EmptyState
            title="Let's set up your household first"
            description="Your goals belong to your household, so we need that before anything else."
            action={{ label: 'Get started', onClick: () => (window.location.href = '/onboarding') }}
          />
        </main>
      </ThemedPage>
    );
  }

  const rows = goals ?? [];

  return (
    <ThemedPage>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={1} className="text-2xl">
              Your goals
            </Heading>
            <Text muted className="mt-1 block text-sm">
              What you are saving towards, and how far along you are.
            </Text>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/household')}>
            Back to dashboard
          </Button>
        </div>

        {error === 'load' && <ErrorState description="We could not load your goals just now." />}
        {error === 'save' && (
          <ErrorState description="We could not save that. Please check the details and try again." />
        )}

        <Card className="mb-6">
          <CardContent>
            <Heading level={2} className="mb-3 text-base">
              {editing ? 'Edit this goal' : 'Add a goal'}
            </Heading>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput
                label="What is it for"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <div>
                <Text muted className="mb-1 block text-xs">
                  Kind of goal
                </Text>
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  aria-label="Kind of goal"
                >
                  {GOAL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
              <LabeledInput
                label="Amount needed (₹)"
                type="number"
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
              />
              <LabeledInput
                label="Saved so far (₹)"
                type="number"
                value={form.saved}
                onChange={(e) => setForm({ ...form, saved: e.target.value })}
              />
              <LabeledInput
                label="When you need it"
                type="date"
                value={form.targetDate}
                onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                onClick={submit}
                disabled={busy || !form.name.trim() || !form.targetDate}
              >
                {editing ? 'Save changes' : 'Add this goal'}
              </Button>
              {editing && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setForm(BLANK);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <EmptyState
            title="No goals yet"
            description="Add what you are saving towards — a home, an education, a year off."
          />
        ) : (
          <div className="space-y-3" data-testid="goal-list">
            {rows.map((g) => (
              <Card key={g.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Text className="font-medium">{g.name}</Text>
                      <Badge>{g.type}</Badge>
                    </div>
                    <Text muted className="mt-1 block text-xs">
                      {formatMoney(g.currentAmountMinor, g.currency)} of{' '}
                      {formatMoney(g.targetAmountMinor, g.currency)} · by{' '}
                      {g.targetDate.slice(0, 10)}
                    </Text>
                    {/*
                      Where the goal actually stands (M5.11). Both figures came from the API —
                      the same numbers that raise the family's Goal Progress signal, so the page
                      and the risk card cannot tell them different things. The status is stated
                      in words as well as tone, because colour alone is not a message.
                    */}
                    <Text muted className="mt-1 block text-xs" data-testid="goal-standing">
                      <span className={STANDING_TONE[goalStanding(g.plan).tone]}>
                        {goalStanding(g.plan).label}
                      </span>
                      {g.plan.gapMinor > 0 ? (
                        <>
                          {' · '}
                          {formatMoney(g.plan.gapMinor, g.currency)} still to fund ·{' '}
                          {formatMoney(g.plan.monthlySipRequiredMinor, g.currency)}/month
                        </>
                      ) : (
                        ' · fully funded at today’s growth'
                      )}
                    </Text>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => edit(g)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(g)} disabled={busy}>
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </ThemedPage>
  );
}
