'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const emailParam = params.get('email') ?? '';
  const tokenParam = params.get('token') ?? '';
  const methodParam = params.get('method') ?? (tokenParam ? 'magic_link' : 'otp');

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMagicLink = methodParam === 'magic_link';

  const verify = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? 'Verification failed');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isMagicLink && tokenParam && emailParam) {
      void verify({ email: emailParam, token: tokenParam, method: 'magic_link' });
    }
    // Only run for the magic-link handoff from the email.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam, emailParam]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-semibold">Verify your email</h1>
        {isMagicLink ? (
          <p className="mt-2 text-sm text-ink-500">{busy ? 'Verifying your sign-in link…' : error ?? 'Link verified.'}</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-500">Enter the 6-digit code we emailed you.</p>
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void verify({ email, code, method: 'otp' });
              }}
            >
              <div>
                <label className="label" htmlFor="verify-email">Email</label>
                <input id="verify-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="code">Code</label>
                <input
                  id="code"
                  className="input"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
                {busy ? 'Verifying…' : 'Sign in'}
              </button>
            </form>
          </>
        )}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <p className="mt-6 text-sm text-ink-500">
          <a className="text-accent hover:underline" href="/login">Back to sign in</a>
        </p>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center text-sm text-ink-500">Loading…</main>}>
      <VerifyForm />
    </Suspense>
  );
}
