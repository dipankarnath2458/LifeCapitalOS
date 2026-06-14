'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { NumberField, parseField } from './NumberField';
import { useToast } from './Toast';

const TYPES = [
  'bank',
  'investment',
  'retirement',
  'real_estate',
  'vehicle',
  'cash',
  'other_asset',
  'loan',
  'credit_card',
];
const CLASSES = ['cash', 'equity', 'debt', 'gold', 'real_estate', 'crypto', 'business', 'other'];
const LIABILITY_TYPES = ['loan', 'credit_card'];

const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Real add-account form (replaces the old hardcoded demo account). */
export function AddAccount({ token, onAdded }: { token: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('bank');
  const [assetClass, setAssetClass] = useState('cash');
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const isLiability = LIABILITY_TYPES.includes(type);

  async function submit() {
    if (!name.trim() || parseField(balance) <= 0) {
      toast.error('Enter an account name and a balance.');
      return;
    }
    setBusy(true);
    try {
      await apiPost(
        '/accounts',
        {
          name: name.trim(),
          type,
          ...(isLiability ? {} : { assetClass }),
          currency: 'INR',
          balanceMinor: parseField(balance) * 100,
          isLiability,
        },
        token,
      );
      toast.success('Account added.');
      setName('');
      setBalance('');
      setOpen(false);
      onAdded();
    } catch {
      toast.error('Could not add the account.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-brand px-3 py-2 text-sm text-white">
        + Add account
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-slate-200 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Account name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. HDFC Savings"
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </label>
        {!isLiability && (
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Asset class</span>
            <select
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </select>
          </label>
        )}
        <NumberField label={isLiability ? 'Outstanding (₹)' : 'Balance (₹)'} value={balance} onChange={setBalance} />
      </div>
      {isLiability && (
        <p className="mt-2 text-xs text-amber-600">This is a liability — it will reduce your net worth.</p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add account'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800">
          Cancel
        </button>
      </div>
    </div>
  );
}
