'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ServiceStatusDto } from '@/types';

type Mode = 'link' | 'otp';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<Mode>('link');
  const [status, setStatus] = useState<ServiceStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/service-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.data) setStatus(json.data as ServiceStatusDto);
      })
      .catch(() => undefined);
  }, []);

  const emailReady = Boolean(status?.emailConfigured);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const path = mode === 'link' ? '/api/auth/request-link' : '/api/auth/request-otp';
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? 'Something went wrong');
        return;
      }
      setMessage(mode === 'link' ? 'Check your inbox for a sign-in link.' : 'Check your inbox for your 6-digit code.');
      router.push(`/verify?email=${encodeURIComponent(email)}&method=${mode}`);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-semibold">Sign in to AI Notetaker</h1>
        <p className="mt-1 text-sm text-ink-500">Passwordless. We will email you a link or a 6-digit code.</p>

        {status && !emailReady && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Email delivery is not configured yet. Sign-in is unavailable until an administrator configures Resend.
          </p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>

          <div className="flex gap-2">
            <button type="button" className={mode === 'link' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('link')}>
              Magic link
            </button>
            <button type="button" className={mode === 'otp' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('otp')}>
              6-digit code
            </button>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy || !emailReady}>
            {busy ? 'Sending…' : mode === 'link' ? 'Email me a sign-in link' : 'Email me a code'}
          </button>
        </form>

        {message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}
