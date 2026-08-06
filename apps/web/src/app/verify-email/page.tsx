'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiPost } from '@/lib/api';
import { AuthCard, buttonClass } from '@/components/AuthCard';

type State = 'checking' | 'verified' | 'invalid' | 'incomplete';

function VerifyEmail() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';
  const [state, setState] = useState<State>(email && token ? 'checking' : 'incomplete');
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!email || !token) return;
    apiPost('/auth/verify-email', { email, token })
      .then(() => setState('verified'))
      .catch(() => setState('invalid'));
  }, [email, token]);

  async function resend() {
    // Always reports success — the API deliberately does not reveal whether the address is
    // registered or already verified.
    await apiPost('/auth/verify-email/request', { email }).catch(() => undefined);
    setResent(true);
  }

  if (state === 'checking') {
    return <AuthCard title="Confirming your email…">
      <p className="text-sm text-slate-600">One moment.</p>
    </AuthCard>;
  }

  if (state === 'verified') {
    return (
      <AuthCard title="Email confirmed">
        <p className="text-sm text-slate-600">
          Thanks — <strong className="text-slate-900">{email}</strong> is now confirmed on your account.
        </p>
        <a href="/app" className={`mt-6 block text-center ${buttonClass}`}>
          Go to your dashboard
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={state === 'incomplete' ? 'Link is incomplete' : 'Link has expired'}>
      <p className="text-sm text-slate-600">
        {state === 'incomplete'
          ? 'This confirmation link is missing information. Open the most recent link from your email.'
          : 'This confirmation link is no longer valid. We can send you a new one.'}
      </p>
      {email && !resent && (
        <button onClick={resend} className={`mt-6 ${buttonClass}`}>
          Send a new link
        </button>
      )}
      {resent && <p className="mt-6 text-sm text-slate-600">Sent. Check your inbox.</p>}
      <a href="/login" className="mt-4 block text-center text-sm text-slate-500 hover:text-brand">
        Back to sign in
      </a>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthCard title="Confirming your email…">Loading…</AuthCard>}>
      <VerifyEmail />
    </Suspense>
  );
}
