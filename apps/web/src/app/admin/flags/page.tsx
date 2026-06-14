'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '@/lib/admin';
import { useToast } from '@/components/Toast';

interface Flag {
  key: string;
  enabled: boolean;
  description: string | null;
  payload: unknown;
}

export default function FlagsPage() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const toast = useToast();

  async function load() {
    setFlags(await adminGet<Flag[]>('/admin/flags'));
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(key: string, body: Record<string, unknown>, msg: string) {
    try {
      await adminSend(`/admin/flags/${encodeURIComponent(key)}`, 'PUT', body);
      toast.success(msg);
      await load();
    } catch {
      toast.error('Could not save the flag.');
    }
  }

  async function createFlag() {
    const key = newKey.trim();
    if (!key) {
      toast.error('Enter a flag key.');
      return;
    }
    if (flags.some((f) => f.key === key)) {
      toast.error('A flag with that key already exists.');
      return;
    }
    await save(key, { enabled: false, description: newDesc.trim() || undefined }, `Flag ${key} created.`);
    setNewKey('');
    setNewDesc('');
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Feature Flags</h1>
      <p className="mb-6 text-sm text-slate-500">
        Toggle modules, edit descriptions, and set JSON config — without a redeploy.
      </p>

      <div className="mb-6 rounded-2xl bg-white p-4 shadow">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">New flag</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="key (e.g. marketplace.enabled)"
            aria-label="New flag key"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 sm:w-72"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="description (optional)"
            aria-label="New flag description"
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
          <button onClick={createFlag} className="rounded-lg bg-brand px-4 py-2 text-sm text-white">
            Create
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {flags.map((f) => (
          <FlagRow key={f.key} flag={f} onSave={save} />
        ))}
      </div>
    </div>
  );
}

function FlagRow({
  flag,
  onSave,
}: {
  flag: Flag;
  onSave: (key: string, body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState(
    flag.payload != null ? JSON.stringify(flag.payload, null, 2) : '',
  );
  const toast = useToast();

  async function savePayload() {
    let parsed: unknown = null;
    if (payload.trim()) {
      try {
        parsed = JSON.parse(payload);
      } catch {
        toast.error('Payload is not valid JSON.');
        return;
      }
    }
    await onSave(flag.key, { payload: parsed }, `${flag.key} config saved.`);
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{flag.key}</div>
          <input
            defaultValue={flag.description ?? ''}
            onBlur={(e) =>
              e.target.value !== (flag.description ?? '') &&
              onSave(flag.key, { description: e.target.value }, `${flag.key} description saved.`)
            }
            placeholder="Add a description…"
            aria-label={`Description for ${flag.key}`}
            className="mt-1 w-full rounded border border-transparent px-1 py-0.5 text-sm text-slate-500 hover:border-slate-200 focus:border-brand focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => setOpen((o) => !o)} className="text-xs text-slate-500 hover:underline">
            {open ? 'Hide config' : 'Config'}
          </button>
          <button
            onClick={() => onSave(flag.key, { enabled: !flag.enabled }, `${flag.key} turned ${flag.enabled ? 'off' : 'on'}.`)}
            aria-pressed={flag.enabled}
            className={`rounded-full px-4 py-1 text-sm ${
              flag.enabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {flag.enabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <label className="text-xs text-slate-500">Payload (JSON)</label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={4}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
            placeholder='e.g. { "rolloutPct": 25 }'
          />
          <button onClick={savePayload} className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-sm text-white">
            Save config
          </button>
        </div>
      )}
    </div>
  );
}
