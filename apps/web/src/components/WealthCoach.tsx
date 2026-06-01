'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'How can I improve my Life Capital Score?',
  'Am I saving enough for retirement?',
  'Should I prepay my home loan or invest?',
];

/** AI Wealth Coach chat — talks to POST /api/ai/coach (premium-gated server-side). */
export function WealthCoach({ token }: { token: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await apiPost<{ reply: string; ai: boolean }>('/ai/coach', { messages: next }, token);
      setMessages([...next, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      // 403 => not on a premium plan.
      const msg = e instanceof Error && e.message.includes('403') ? '' : '';
      setLocked(true);
      void msg;
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">AI Wealth Coach</h2>
        <p className="mt-2 text-sm text-slate-600">
          The AI Wealth Coach is a <strong>Premium</strong> feature. Upgrade your plan to get
          personalised, plain-English guidance grounded in your real finances.
        </p>
        <a
          href="/billing"
          className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          See plans
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-1 text-lg font-semibold">AI Wealth Coach</h2>
      <p className="mb-4 text-sm text-slate-500">
        Personalised guidance based on your actual net worth and scores.
      </p>

      <div className="mb-4 max-h-80 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-brand/10 hover:text-brand"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                m.role === 'user' ? 'bg-brand text-white' : 'bg-slate-100 text-slate-800'
              }`}
            >
              {m.content}
            </span>
          </div>
        ))}
        {busy && <div className="text-sm text-slate-400">Coach is thinking…</div>}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(input)}
          placeholder="Ask your money question…"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <button
          onClick={() => send(input)}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Send
        </button>
      </div>
    </div>
  );
}
