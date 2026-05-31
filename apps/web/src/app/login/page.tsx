'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';

/** Phone-OTP login (India-first). In sandbox the API returns the code for testing. */
export default function LoginPage() {
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
      const res = await apiPost<{ accessToken: string; refreshToken: string }>('/auth/otp/verify', {
        channel: 'phone',
        target,
        code,
      });
      localStorage.setItem('lcos_access', res.accessToken);
      localStorage.setItem('lcos_refresh', res.refreshToken);
      window.location.href = '/dashboard';
    } catch {
      setMessage('Invalid or expired code.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <h1 className="mb-6 text-2xl font-bold text-brand">Welcome back</h1>
        {step === 'request' ? (
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
          </>
        ) : (
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
          </>
        )}
        {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}
      </div>
    </main>
  );
}
