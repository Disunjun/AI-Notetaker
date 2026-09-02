'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/api';
import type { ResendConfigDto } from '@/types';

export function ResendManager({ config }: { config: ResendConfigDto | null }) {
  const router = useRouter();
  const [fromEmail, setFromEmail] = useState(config?.fromEmail ?? '');
  const [fromName, setFromName] = useState(config?.fromName ?? '');
  const [replyTo, setReplyTo] = useState(config?.replyTo ?? '');
  const [apiKey, setApiKey] = useState('');
  const [isActive, setIsActive] = useState(config?.isActive ?? true);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api<ResendConfigDto>('/api/admin/resend', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromEmail,
          fromName: fromName || null,
          replyTo: replyTo || null,
          apiKey: apiKey || undefined,
          isActive,
        }),
      });
      setApiKey('');
      setMessage('Saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ ok: boolean; error?: string }>('/api/admin/resend/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      });
      setMessage(result.ok ? 'Test email sent.' : `Test failed: ${result.error}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="mb-4 text-lg font-semibold text-ink-900">Resend configuration</h2>
        {config && (
          <p className="mb-4 text-sm text-ink-500">
            Current key: <span className="font-mono">{config.apiKeyMasked}</span> · last test{' '}
            {config.lastTestedAt ? `${config.lastTestOk ? 'OK' : 'FAILED'} · ${new Date(config.lastTestedAt).toLocaleString()}` : 'never'}
          </p>
        )}
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="from-email">From email</label>
            <input id="from-email" className="input" type="email" required value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="notes@yourdomain.com" />
          </div>
          <div>
            <label className="label" htmlFor="from-name">From name</label>
            <input id="from-name" className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="AI Notetaker" />
          </div>
          <div>
            <label className="label" htmlFor="reply-to">Reply-to (optional)</label>
            <input id="reply-to" className="input" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="resend-key">API key (leave blank to keep the existing key)</label>
            <input id="resend-key" className="input" type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary" disabled={busy}>Save</button>
          </div>
        </form>
        {message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      </section>

      <section className="card">
        <h2 className="mb-2 text-lg font-semibold text-ink-900">Send a test email</h2>
        <p className="mb-4 text-sm text-ink-500">This never creates a processing job.</p>
        <form onSubmit={sendTest} className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label className="label" htmlFor="test-to">Recipient</label>
            <input id="test-to" className="input" type="email" required value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>Send test</button>
        </form>
      </section>
    </div>
  );
}
