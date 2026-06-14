'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '@/lib/admin';

interface Flag {
  key: string;
  enabled: boolean;
  description: string | null;
}

export default function FlagsPage() {
  const [flags, setFlags] = useState<Flag[]>([]);

  async function load() {
    setFlags(await adminGet<Flag[]>('/admin/flags'));
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(f: Flag) {
    await adminSend(`/admin/flags/${f.key}`, 'PUT', { enabled: !f.enabled });
    await load();
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Feature Flags</h1>
      <p className="mb-6 text-sm text-slate-500">
        Toggle monetization modules and platform features without a redeploy.
      </p>
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <ul className="divide-y divide-slate-100">
          {flags.map((f) => (
            <li key={f.key} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{f.key}</div>
                <div className="text-sm text-slate-500">{f.description}</div>
              </div>
              <button
                onClick={() => toggle(f)}
                className={`rounded-full px-4 py-1 text-sm ${
                  f.enabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {f.enabled ? 'On' : 'Off'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
