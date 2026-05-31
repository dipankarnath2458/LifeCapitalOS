'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';

type Tab = 'email' | 'phone';
type EmailMode = 'signin' | 'signup';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function persistAndGo(tokens: TokenPair) {
  localStorage.setItem('lcos_access', tokens.accessToken);
  localStorage.setItem('lcos_refresh', tokens.refreshToken);
  window.location.href = '/dashboard';
}

/**
 * Web login. Email + password (sign in / sign up) is the default path so it works
 * without an SMS provider. Phone OTP remains available; in sandbox the API returns
 * the code on screen for testing.
 */
export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('email');

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <h1 className="mb-6 text-2xl font-bold text-brand">Welcome to Life Capital OS</h1>

        <div className="mb-6 flex rounded-lg bg-slate-100 p-1 text-sm">
          <button
            onClick={() => setTab('email')}
            className={`flex-1 rounded-md py-2 font-medium ${
              tab === 'email' ? 'bg-white text-brand shadow' : 'text-slate-500'
            }`}
          >
            Email
          </button>
          <button
            onClick={() => setTab('phone')}
            className={`flex-1 rounded-md py-2 font-medium ${
              tab === 'phone' ? 'bg-white text-brand shadow' : 'text-slate-500'
            }`}
          >
            Phone
          </button>
        </div>

        {tab === 'email' ? <EmailAuth /> : <PhoneAuth />}
      </div>
    </main>
  );
}

function EmailAuth() {
  const [mode, setMode] = useState<EmailMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const tokens =
        mode === 'signup'
          ? await apiPost<TokenPair>('/auth/register', { email, password, fullName })
          : await apiPost<TokenPair>('/auth/login', { email, password });
      persistAndGo(tokens);
    } catch {
      setMessage(
        mode === 'signup'
          ? 'Could not create account. The email may already be registered.'
          : 'Invalid email or password.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {mode === 'signup' && (
        <>
          <label className="mb-1 block text-sm text-slate-600">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
            className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </>
      )}
      <label className="mb-1 block text-sm text-slate-600">Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2"
      />
      <label className="mb-1 block text-sm text-slate-600">Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2"
      />
      <button
        onClick={submit}
        disabled={busy}
        className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      <button
        onClick={() => {
          setMode(mode === 'signup' ? 'signin' : 'signup');
          setMessage(null);
        }}
        className="mt-4 w-full text-center text-sm text-slate-500 hover:text-brand"
      >
        {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
      {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}
    </>
  );
}

function PhoneAuth() {
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function requestOtp() {
    try {
      const res = await apiPost<{ sent: boolean; devCode?: string }>('/auth/otp/request', {
        channel: 'phone',
        target,
      });
      setDevCode(res.devCode ?? null);
      setStep('verify');
      setMessage(null);
    } catch {
      setMessage('Could not send OTP. Is the API running?');
    }
  }

  async function verifyOtp() {
    try {
      const tokens = await apiPost<TokenPair>('/auth/otp/verify', {
        channel: 'phone',
        target,
        code,
      });
      persistAndGo(tokens);
    } catch {
      setMessage('Invalid or expired code.');
    }
  }

  if (step === 'request') {
    return (
      <>
        <label className="mb-1 block text-sm text-slate-600">Mobile number</label>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="+919876543210"
          className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2"
        />
        <button
          onClick={requestOtp}
          className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark"
        >
          Send OTP
        </button>
        {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}
      </>
    );
  }

  return (
    <>
      <label className="mb-1 block text-sm text-slate-600">Enter 6-digit code</label>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="123456"
        className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 tracking-widest"
      />
      {devCode && (
        <p className="mb-4 rounded bg-amber-50 p-2 text-xs text-amber-700">
          Dev OTP: <strong>{devCode}</strong>
        </p>
      )}
      <button
        onClick={verifyOtp}
        className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark"
      >
        Verify &amp; continue
      </button>
      {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}
    </>
  );
}
