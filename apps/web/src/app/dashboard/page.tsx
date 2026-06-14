'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { WealthCoach } from '@/components/WealthCoach';
import { SecondOpinion } from '@/components/SecondOpinion';
import { EarlyWarning } from '@/components/EarlyWarning';
import { Goals } from '@/components/Goals';
import { Family } from '@/components/Family';
import { Protection } from '@/components/Protection';
import { NetWorthChart } from '@/components/NetWorthChart';
import { AllocationDonut } from '@/components/AllocationDonut';

interface NetWorth {
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  currency: string;
}
interface Account {
  id: string;
  name: string;
  balanceMinor: number;
  isLiability: boolean;
}

const inr = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    minor / 100,
  );

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorth | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Bumped when protection details change, to re-run the Early Warning scan.
  const [warningKey, setWarningKey] = useState(0);

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
    try {
      const [nw, accs] = await Promise.all([
        apiGet<NetWorth>('/net-worth/current', t),
        apiGet<Account[]>('/accounts', t),
      ]);
      setNetWorth(nw);
      setAccounts(accs);
      // First-run: nudge new users into the guided onboarding instead of a cold dashboard.
      if (accs.length === 0 && !localStorage.getItem('lcos_onboarded')) {
        window.location.href = '/onboarding';
      }
    } catch {
      window.location.href = '/login';
    }
  }

  function logout() {
    localStorage.removeItem('lcos_access');
    localStorage.removeItem('lcos_refresh');
    window.location.href = '/login';
  }

  async function addDemoAccount() {
    if (!token) return;
    await apiPost('/accounts', { name: 'Savings', type: 'bank', currency: 'INR', balanceMinor: 50000000 }, token);
    await load(token);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your Family Balance Sheet</h1>
        <nav className="flex items-center gap-4 text-sm">
          <a href="/billing" className="text-brand hover:underline">
            Plans
          </a>
          <button onClick={logout} className="text-slate-500 hover:text-slate-800">
            Sign out
          </button>
        </nav>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat label="Net Worth" value={netWorth ? inr(netWorth.netWorthMinor) : '—'} highlight />
        <Stat label="Assets" value={netWorth ? inr(netWorth.assetsMinor) : '—'} />
        <Stat label="Liabilities" value={netWorth ? inr(netWorth.liabilitiesMinor) : '—'} />
      </div>

      {token && (
        <div className="mb-8 grid gap-8 lg:grid-cols-2">
          <NetWorthChart token={token} />
          <AllocationDonut token={token} />
        </div>
      )}

      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Accounts</h2>
          <button onClick={addDemoAccount} className="rounded-lg bg-brand px-3 py-2 text-sm text-white">
            + Add account
          </button>
        </div>
        {accounts.length === 0 ? (
          <p className="text-slate-500">No accounts yet. Add one to build your balance sheet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {accounts.map((a) => (
              <li key={a.id} className="flex justify-between py-3">
                <span>{a.name}</span>
                <span className={a.isLiability ? 'text-rose-600' : 'text-emerald-600'}>
                  {inr(a.balanceMinor)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {token && (
        <div className="mt-8">
          <EarlyWarning key={warningKey} token={token} />
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {token && <Goals token={token} />}
        {token && <Protection token={token} onSaved={() => setWarningKey((k) => k + 1)} />}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {token && <Family token={token} />}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {token && <WealthCoach token={token} />}
        {token && <SecondOpinion token={token} />}
      </div>
    </main>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl p-6 shadow ${highlight ? 'bg-brand text-white' : 'bg-white'}`}>
      <div className={`text-sm ${highlight ? 'text-brand-light' : 'text-slate-500'}`}>{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
