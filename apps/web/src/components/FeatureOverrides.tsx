'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '@/lib/admin';
import { useToast } from './Toast';
import { Modal } from './Modal';

type State = 'default' | 'granted' | 'revoked';

const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Per-user feature overrides. An override grants or revokes a feature on top of the
 * user's plan tier; clearing it reverts to the tier default. Backed by the admin API.
 */
export function FeatureOverrides({
  userId,
  userLabel,
  onClose,
}: {
  userId: string;
  userLabel: string;
  onClose: () => void;
}) {
  const [features, setFeatures] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    try {
      const [all, current] = await Promise.all([
        adminGet<string[]>('/admin/features'),
        adminGet<{ feature: string; enabled: boolean }[]>(`/admin/users/${userId}/feature-overrides`),
      ]);
      setFeatures(all);
      setOverrides(Object.fromEntries(current.map((o) => [o.feature, o.enabled])));
    } catch {
      toast.error('Could not load feature overrides.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function stateOf(feature: string): State {
    if (!(feature in overrides)) return 'default';
    return overrides[feature] ? 'granted' : 'revoked';
  }

  async function set(feature: string, next: State) {
    try {
      if (next === 'default') {
        await adminSend(`/admin/users/${userId}/feature-override/${feature}`, 'DELETE');
      } else {
        await adminSend(`/admin/users/${userId}/feature-override`, 'POST', {
          feature,
          enabled: next === 'granted',
        });
      }
      toast.success(`${label(feature)} set to ${next}.`);
      await load();
    } catch {
      toast.error('Could not update the override.');
    }
  }

  return (
    <Modal title={`Feature access · ${userLabel}`} onClose={onClose}>
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {features.map((f) => {
            const state = stateOf(f);
            return (
              <li key={f} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-2">
                <span className="text-sm">{label(f)}</span>
                <div className="flex gap-1" role="group" aria-label={`Access for ${label(f)}`}>
                  {(['default', 'granted', 'revoked'] as State[]).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => state !== opt && set(f, opt)}
                      aria-pressed={state === opt}
                      className={`rounded-md px-2 py-1 text-xs capitalize ${
                        state === opt
                          ? opt === 'granted'
                            ? 'bg-emerald-600 text-white'
                            : opt === 'revoked'
                              ? 'bg-rose-600 text-white'
                              : 'bg-slate-700 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-4 text-xs text-slate-400">
        “Default” follows the user’s plan tier. Grant or revoke overrides it for this user only.
      </p>
    </Modal>
  );
}
