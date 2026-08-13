'use client';

/**
 * Your family — native V2 surface (M5.8 PR 1).
 *
 * Design: `docs/M5_8_FAMILY_ARCHITECTURE.md`.
 *
 * Replaces the temporary surface that mounted V1's `Family` component. That component writes
 * `FamilyMember` (keyed on `userId`); the Financial Snapshot reads `HouseholdMember` (keyed on
 * `householdId`). Two stores, one of them read — so adding family in V1 changed no figure
 * anywhere: not the dependants count behind recommended life cover, not the ages behind
 * retirement.
 *
 * V1's page remains on `/dashboard`, untouched, as the safety net.
 *
 * **Date of birth is why this page matters.** V1 never captured one and onboarding does not set
 * one, so every consumer's retirement section reports `available: false`. Entering a date of birth
 * here is what makes a retirement projection appear on the dashboard.
 *
 * Composed entirely from the frozen design system.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/session';
import {
  addMember,
  hasPortalLogin,
  listMembers,
  removeMember,
  toDateInput,
  updateMember,
  type HouseholdMemberRecord,
} from '@/lib/householdMembers';
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

const RELATIONS = ['self', 'spouse', 'child', 'parent', 'sibling', 'other'] as const;

const BLANK = { name: '', relation: 'spouse', dateOfBirth: '', isDependent: true };

export default function FamilyPage() {
  const [token, setToken] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMemberRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(BLANK);
  /** The member being edited, or null when adding. */
  const [editing, setEditing] = useState<HouseholdMemberRecord | null>(null);

  const load = useCallback(async (t: string) => {
    try {
      const rows = await listMembers(t);
      if (!rows) {
        setError('needs-onboarding');
        return;
      }
      setMembers(rows);
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
    void load(t);
  }, [load]);

  async function submit() {
    if (!token || !form.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: form.name.trim(),
        relation: form.relation,
        dateOfBirth: form.dateOfBirth || null,
        isDependent: form.isDependent,
      };
      if (editing) await updateMember(token, editing.id, input);
      else await addMember(token, input);
      setForm(BLANK);
      setEditing(null);
      await load(token);
    } catch {
      setError('save');
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: HouseholdMemberRecord) {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeMember(token, member.id);
      await load(token);
    } catch {
      // The API refuses to remove a member who has a sign-in, because that row is the
      // post-login routing signal. The control is hidden for those members, so reaching this
      // is unusual — but the message has to be truthful rather than generic.
      setError('remove');
    } finally {
      setBusy(false);
    }
  }

  function edit(member: HouseholdMemberRecord) {
    setEditing(member);
    setForm({
      name: member.name ?? '',
      relation: member.relation,
      dateOfBirth: toDateInput(member.dateOfBirth),
      isDependent: member.isDependent,
    });
  }

  if (!token || (members === null && error === null)) {
    return (
      <ThemedPage>
        <LoadingState label="Loading your family…" />
      </ThemedPage>
    );
  }

  if (error === 'needs-onboarding') {
    return (
      <ThemedPage>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <EmptyState
            title="Let's set up your household first"
            description="Your family lives inside your household, so we need that before anything else."
            action={{ label: 'Get started', onClick: () => (window.location.href = '/onboarding') }}
          />
        </main>
      </ThemedPage>
    );
  }

  const rows = members ?? [];
  const withoutDob = rows.filter((m) => !m.dateOfBirth).length;

  return (
    <ThemedPage>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={1} className="text-2xl">
              Your family
            </Heading>
            <Text muted className="mt-1 block text-sm">
              Who is in your household. Dates of birth let us project your retirement, and
              dependants shape how much life cover we recommend.
            </Text>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/household')}>
            Back to dashboard
          </Button>
        </div>

        {/* Says plainly what is missing and what it costs, rather than leaving a panel blank
            elsewhere with no explanation. */}
        {withoutDob > 0 && (
          <div
            className="mb-6 rounded-card border border-border bg-muted/40 px-4 py-3"
            data-testid="dob-missing-notice"
          >
            <Text muted className="block text-xs">
              {withoutDob === 1 ? 'One person has' : `${withoutDob} people have`} no date of birth
              yet. Add one and your retirement projection will appear on your dashboard.
            </Text>
          </div>
        )}

        {error === 'load' && <ErrorState description="We could not load your family just now." />}
        {error === 'save' && (
          <ErrorState description="We could not save that. Please check the details and try again." />
        )}
        {error === 'remove' && (
          <ErrorState description="That person has a sign-in for this household, so they cannot be removed here." />
        )}

        <Card className="mb-6">
          <CardContent>
            <Heading level={2} className="mb-3 text-base">
              {editing ? 'Edit this person' : 'Add someone'}
            </Heading>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput
                label="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <div>
                <Text muted className="mb-1 block text-xs">
                  Relationship
                </Text>
                <Select
                  value={form.relation}
                  onChange={(e) => setForm({ ...form, relation: e.target.value })}
                  aria-label="Relationship"
                >
                  {RELATIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </div>
              <LabeledInput
                label="Date of birth"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              />
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.isDependent}
                  onChange={(e) => setForm({ ...form, isDependent: e.target.checked })}
                />
                Depends on your income
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={submit} disabled={busy || !form.name.trim()}>
                {editing ? 'Save changes' : 'Add to my family'}
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
            title="No one here yet"
            description="Add the people who depend on you, so your cover and retirement figures reflect your real family."
          />
        ) : (
          <div className="space-y-3" data-testid="member-list">
            {rows.map((m) => (
              <Card key={m.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Text className="font-medium">{m.name}</Text>
                      <Badge>{m.relation}</Badge>
                      {m.isDependent && <Badge tone="warning">dependant</Badge>}
                    </div>
                    <Text muted className="mt-1 block text-xs">
                      {m.dateOfBirth
                        ? `Born ${toDateInput(m.dateOfBirth)}`
                        : 'No date of birth yet'}
                    </Text>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => edit(m)}>
                      Edit
                    </Button>
                    {/* Hidden for anyone with a sign-in: that row is the post-login routing
                        signal, and removing it would send them to the Advisor Workspace. The API
                        refuses regardless — this only avoids offering an action that cannot
                        succeed. */}
                    {!hasPortalLogin(m) && (
                      <Button variant="ghost" size="sm" onClick={() => remove(m)} disabled={busy}>
                        Remove
                      </Button>
                    )}
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
