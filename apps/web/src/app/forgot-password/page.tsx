'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { AuthCard, buttonClass, inputClass, labelClass } from '@/components/AuthCard';

/**
 * Request a password-reset email.
 *
 * The confirmation is deliberately identical whether or not the address is registered —
 * the API answers the same way for the same reason, and contradicting it here would turn
 * this page into an account-existence oracle.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim()) return;
    setState('busy');
    setError(null);
    try {
      await apiPost('/auth/forgot-password', { email: email.trim() });
      setState('sent');
    } catch {
      // The only real failure the API surfaces here is the per-address send throttle.
      setError('Too many requests. Please wait a few minutes and try again.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <AuthCard title="Check your email">
        <p className="text-sm text-slate-600">
          If an account exists for <strong className="text-slate-900">{email}</strong>, we&apos;ve sent a link
          to reset your password. It expires in 30 minutes.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Nothing arrived? Check your spam folder, or{' '}
          <button type="button" onClick={() => setState('idle')} className="text-brand hover:underline">
            try a different address
          </button>
          .
        </p>
        <a href="/login" className="mt-6 block text-center text-sm text-slate-500 hover:text-brand">
          Back to sign in
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password">
      <p className="mb-6 text-sm text-slate-600">
        Enter the email address on your account and we&apos;ll send you a link to set a new password.
      </p>
      <label className={labelClass} htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="you@example.com"
        className={inputClass}
      />
      <button onClick={submit} disabled={state === 'busy'} className={buttonClass}>
        {state === 'busy' ? 'Sending…' : 'Send reset link'}
      </button>
      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
      <a href="/login" className="mt-4 block text-center text-sm text-slate-500 hover:text-brand">
        Back to sign in
      </a>
    </AuthCard>
  );
}
