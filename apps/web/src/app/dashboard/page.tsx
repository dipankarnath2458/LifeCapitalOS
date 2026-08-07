'use client';

/**
 * Retail (consumer) dashboard — the destination for users who are NOT members of a firm.
 *
 * This is the V1 dashboard, restored. It was retired in d1f8824 when M5.5 made `/app` the
 * single authenticated destination, but that left consumers with nowhere to go: `/app` is
 * firm-gated, and `Household.firmId` is NOT NULL, so a user without a firm cannot have a
 * household at all. Every consumer therefore landed on "No firm yet — ask a firm owner to
 * invite you", which is a dead end for a consumer product.
 *
 * Restored rather than rebuilt: the page was intact in git history and every component it
 * imports was still in the repo. The retail data model is live too — `Account.userId` is
 * the retail path, distinct from the advisory `householdId` path.
 *
 * TEMPORARY BY DESIGN. This is V1 UI, not the frozen V2 design system. It stands until the
 * V2 consumer dashboard ships in M5.5, at which point this route should point there and
 * this file can go.
 *
 * Adapted from the original in two ways that matter: it reads the token via
 * `getAccessToken()` and signs out via `signOut()`, so consumers get the same single-flight
 * token refresh and server-side revocation as everyone else. The verbatim V1 code touched
 * localStorage directly, which would have re-introduced the 15-minute logout bug for
 * exactly the users this page exists to serve.
 */

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { getAccessToken, signOut } from '@/lib/session';
import { AddAccount } from '@/components/AddAccount';
import { WealthCoach } from '@/components/WealthCoach';
import { SecondOpinion } from '@/components/SecondOpinion';
import { EarlyWarning } from '@/components/EarlyWarning';
import { Goals } from '@/components/Goals';
import { Family } from '@/components/Family';
import { Protection } from '@/components/Protection';
import { NetWorthChart } from '@/components/NetWorthChart';
import { AllocationDonut } from '@/components/AllocationDonut';
import { isAdminRole } from '@/lib/admin';

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
  const [isAdmin, setIsAdmin] = useState(false);
  // Bumped when protection details change, to re-run the Early Warning scan.
  const [warningKey, setWarningKey] = useState(0);

  useEffect(() => {
    const t = getAccessToken();
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
    void load(t);
  }, []);

  async function load(t: string) {
    try {
      const [nw, accs, me] = await Promise.all([
        apiGet<NetWorth>('/net-worth/current', t),
        apiGet<Account[]>('/accounts', t),
        apiGet<{ role?: string }>('/auth/me', t).catch(() => ({ role: undefined })),
      ]);
      setNetWorth(nw);
      setAccounts(accs);
      setIsAdmin(isAdminRole(me.role));
      // First-run: nudge new users into the guided onboarding instead of a cold dashboard.
      if (accs.length === 0 && !localStorage.getItem('lcos_onboarded')) {
        window.location.href = '/onboarding';
      }
    } catch {
      window.location.href = '/login';
    }
  }

  function logout() {
    // Goes through signOut() rather than clearing localStorage directly, so the refresh
    // token is revoked server-side. The V1 original only cleared local state and left a
    // token valid for 30 days in the database.
    void signOut();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your Family Balance Sheet</h1>
        <nav className="flex items-center gap-4 text-sm">
          {isAdmin && (
            <a href="/admin" className="font-medium text-brand hover:underline">
              Admin
            </a>
          )}
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
        <h2 className="mb-4 text-lg font-semibold">Accounts</h2>
        {token && (
          <div className="mb-4">
            <AddAccount token={token} onAdded={() => load(token)} />
          </div>
        )}
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
