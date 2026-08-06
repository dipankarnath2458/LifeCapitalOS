'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiPost } from '@/lib/api';
import { AuthCard, buttonClass, inputClass, labelClass } from '@/components/AuthCard';

/** Mirrors the API's ResetPasswordDto so the user sees the rule before submitting. */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';
  return null;
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!email || !token) {
    return (
      <AuthCard title="Link is incomplete">
        <p className="text-sm text-slate-600">
          This reset link is missing information. Open the most recent link from your email, or request a
          new one.
        </p>
        <a href="/forgot-password" className="mt-6 block text-center text-sm text-brand hover:underline">
          Request a new link
        </a>
      </AuthCard>
    );
  }

  async function submit() {
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('The two passwords do not match.');

    setState('busy');
    setError(null);
    try {
      await apiPost('/auth/reset-password', { email, token, newPassword: password });
      setState('done');
    } catch {
      // The API returns 400/401 for an expired, already-used or wrong token — all of which
      // mean the same thing to the user: get a fresh link.
      setError('This link is invalid or has expired. Request a new one.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <AuthCard title="Password updated">
        <p className="text-sm text-slate-600">
          Your password has been changed and you&apos;ve been signed out everywhere else.
        </p>
        <a href="/login" className={`mt-6 block text-center ${buttonClass}`}>
          Sign in
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password">
      <p className="mb-6 text-sm text-slate-600">
        For <strong className="text-slate-900">{email}</strong>
      </p>
      <label className={labelClass} htmlFor="password">
        New password
      </label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters, including a number"
        className={inputClass}
      />
      <label className={labelClass} htmlFor="confirm">
        Confirm new password
      </label>
      <input
        id="confirm"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="••••••••"
        className={inputClass}
      />
      <button onClick={submit} disabled={state === 'busy'} className={buttonClass}>
        {state === 'busy' ? 'Saving…' : 'Update password'}
      </button>
      {error && (
        <p className="mt-4 text-sm text-rose-600">
          {error}{' '}
          {error.includes('expired') && (
            <a href="/forgot-password" className="underline">
              Request a new link
            </a>
          )}
        </p>
      )}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary for the App Router's static generation.
  return (
    <Suspense fallback={<AuthCard title="Set a new password">Loading…</AuthCard>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
