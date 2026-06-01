'use client';

import { useState } from 'react';
import { HealthCheck } from '@/components/HealthCheck';
import { RetirementCalculator } from '@/components/RetirementCalculator';
import { InsuranceGap } from '@/components/InsuranceGap';
import { WealthDna } from '@/components/WealthDna';

type Tool = 'health' | 'retirement' | 'insurance' | 'dna';

const TABS: { key: Tool; label: string; blurb: string }[] = [
  { key: 'health', label: 'Wealth Health Check', blurb: 'Your overall financial health score in 60 seconds.' },
  { key: 'retirement', label: 'Retirement Readiness', blurb: 'The corpus you need and the SIP to get there.' },
  { key: 'insurance', label: 'Insurance Gap', blurb: 'Is your family adequately protected?' },
  { key: 'dna', label: 'Wealth DNA', blurb: 'Discover your financial personality — and its blind spots.' },
];

/** Tabbed free-tools section — the lead-generation engine, all client-side. */
export function ToolsSection() {
  const [tool, setTool] = useState<Tool>('health');
  const active = TABS.find((t) => t.key === tool)!;

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTool(t.key)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              tool === t.key
                ? 'bg-brand text-white'
                : 'bg-white text-slate-600 shadow hover:text-brand'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-6 text-slate-600">{active.blurb}</p>
      {tool === 'health' && <HealthCheck />}
      {tool === 'retirement' && <RetirementCalculator />}
      {tool === 'insurance' && <InsuranceGap />}
      {tool === 'dna' && <WealthDna />}
    </div>
  );
}
