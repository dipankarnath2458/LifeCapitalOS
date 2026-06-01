'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

type Archetype = 'builder' | 'protector' | 'explorer' | 'achiever';
interface Question {
  id: string;
  prompt: string;
  options: { label: string; archetype: Archetype }[];
}
interface Result {
  archetype: Archetype;
  title: string;
  tagline: string;
  traits: string[];
  blindSpots: string[];
  nextStep: string;
}

const EMOJI: Record<Archetype, string> = { builder: '🏗️', protector: '🛡️', explorer: '🧭', achiever: '🎯' };

/** Wealth DNA — a no-login personality quiz. Public lead-gen tool. */
export function WealthDna() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, Archetype>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ questions: Question[] }>('/tools/wealth-dna/questions')
      .then((r) => setQuestions(r.questions))
      .catch(() => {});
  }, []);

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id]);

  async function submit() {
    setBusy(true);
    try {
      const ordered = questions.map((q) => answers[q.id]);
      setResult(await apiPost<Result>('/tools/wealth-dna', { answers: ordered }));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-2xl bg-white p-8 shadow">
        <div className="text-center">
          <div className="text-5xl">{EMOJI[result.archetype]}</div>
          <h3 className="mt-3 text-2xl font-bold">{result.title}</h3>
          <p className="text-slate-500">{result.tagline}</p>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-emerald-50 p-4">
            <h4 className="mb-2 text-sm font-semibold text-emerald-700">Your strengths</h4>
            <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
              {result.traits.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-amber-50 p-4">
            <h4 className="mb-2 text-sm font-semibold text-amber-700">Watch out for</h4>
            <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
              {result.blindSpots.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-brand/10 p-4 text-sm">
          <span className="font-semibold text-brand">Next step: </span>
          {result.nextStep}
        </div>
        <button
          onClick={() => {
            setResult(null);
            setAnswers({});
          }}
          className="mt-4 text-sm text-slate-500 hover:text-brand"
        >
          ↺ Retake the quiz
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      {questions.length === 0 ? (
        <p className="text-slate-500">Loading quiz…</p>
      ) : (
        <div className="space-y-6">
          {questions.map((q, i) => (
            <div key={q.id}>
              <p className="mb-2 font-medium">
                {i + 1}. {q.prompt}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map((o) => {
                  const selected = answers[q.id] === o.archetype;
                  return (
                    <button
                      key={o.label}
                      onClick={() => setAnswers({ ...answers, [q.id]: o.archetype })}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        selected ? 'border-brand bg-brand/10 text-brand' : 'border-slate-200 hover:border-brand'
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            onClick={submit}
            disabled={!allAnswered || busy}
            className="w-full rounded-lg bg-brand px-4 py-3 font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Analyzing…' : 'Reveal my Wealth DNA'}
          </button>
        </div>
      )}
    </div>
  );
}
