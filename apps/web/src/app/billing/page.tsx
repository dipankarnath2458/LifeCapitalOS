'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useToast } from '@/components/Toast';

interface Plan {
  id: string;
  tier: string;
  name: string;
  priceMinor: number;
  currency: string;
  interval: string;
  active: boolean;
}
interface Entitlements {
  tier: string;
  features: string[];
}

const inr = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    minor / 100,
  );

const TIER_BLURB: Record<string, string> = {
  free: 'Wealth Health Check, balance sheet, goals, retirement and debt tools.',
  premium: 'Everything in Free, plus the AI Wealth Coach, Second Opinion, scenario simulator and account aggregation.',
  family_cfo: 'Everything in Premium, plus advisor consultations and unlimited family members.',
};

export default function BillingPage() {
  const [token, setToken] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('lcos_access') : null;
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
    void load(t);
  }, []);

  async function load(t: string) {
    const [p, e] = await Promise.all([
      apiGet<Plan[]>('/billing/plans'),
      apiGet<Entitlements>('/billing/entitlements', t).catch(() => null),
    ]);
    setPlans(p.sort((a, b) => a.priceMinor - b.priceMinor));
    setEnt(e);
  }

  async function subscribe(tier: string) {
    if (!token) return;
    setBusy(tier);
    try {
      const res = await apiPost<{ status: string }>('/billing/subscribe', { tier }, token);
      toast.success(`Subscription ${res.status}. Your new features are now unlocked.`);
      await load(token);
    } catch {
      toast.error('Could not start the subscription. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const currentTier = ent?.tier ?? 'free';

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plans &amp; Billing</h1>
        <a href="/dashboard" className="text-sm text-brand hover:underline">
          ← Back to dashboard
        </a>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.tier === currentTier;
          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-6 shadow ${
                isCurrent ? 'border-brand bg-brand/5' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                {isCurrent && (
                  <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white">Current</span>
                )}
              </div>
              <div className="mt-2 text-3xl font-bold">
                {plan.priceMinor === 0 ? 'Free' : inr(plan.priceMinor)}
                {plan.priceMinor > 0 && <span className="text-base font-normal text-slate-500">/mo</span>}
              </div>
              <p className="mt-3 flex-1 text-sm text-slate-600">{TIER_BLURB[plan.tier] ?? ''}</p>
              <button
                onClick={() => subscribe(plan.tier)}
                disabled={isCurrent || busy === plan.tier || plan.tier === 'free'}
                className="mt-6 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {isCurrent
                  ? 'Your plan'
                  : plan.tier === 'free'
                    ? 'Included'
                    : busy === plan.tier
                      ? 'Starting…'
                      : `Upgrade to ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-slate-400">
        Payments are processed securely via Razorpay. In sandbox mode subscriptions activate immediately for testing.
      </p>
    </main>
  );
}
