'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/api';
import type { AIProviderConfigDto, ProviderModelsDto, ProviderTestResultDto } from '@/types';

const ROLES = ['TRANSCRIPTION', 'TEXT'] as const;
const PROVIDERS = ['OPENAI', 'GROQ', 'GOOGLE', 'ANTHROPIC', 'OPENAI_COMPATIBLE'] as const;

interface FormState {
  role: (typeof ROLES)[number];
  name: string;
  provider: (typeof PROVIDERS)[number];
  baseUrl: string;
  model: string;
  apiKey: string;
  isPrimary: boolean;
  priority: number;
  isActive: boolean;
  timeoutMs: number;
}

const EMPTY: FormState = {
  role: 'TEXT',
  name: '',
  provider: 'OPENAI',
  baseUrl: '',
  model: '',
  apiKey: '',
  isPrimary: true,
  priority: 100,
  isActive: true,
  timeoutMs: 60000,
};

export function AIProvidersManager({ providers }: { providers: AIProviderConfigDto[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[] | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api<AIProviderConfigDto>(`/api/admin/ai-providers/${form.role}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          provider: form.provider,
          baseUrl: form.baseUrl || null,
          model: form.model,
          apiKey: form.apiKey || undefined,
          isPrimary: form.isPrimary,
          priority: form.priority,
          isActive: form.isActive,
          timeoutMs: form.timeoutMs,
        }),
      });
      setMessage('Saved.');
      setForm(EMPTY);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const test = async (configId?: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const role = configId ? (providers.find((p) => p.id === configId)?.role ?? form.role) : form.role;
      const body = configId
        ? { configId }
        : {
            name: form.name || 'ad-hoc',
            provider: form.provider,
            baseUrl: form.baseUrl || null,
            model: form.model || 'unknown',
            apiKey: form.apiKey,
          };
      const result = await api<ProviderTestResultDto>(`/api/admin/ai-providers/${role}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setMessage(result.ok ? `Connection OK (${result.latencyMs}ms)` : `Connection failed: ${result.error}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setBusy(false);
    }
  };

  const listModels = async (configId?: string) => {
    setBusy(true);
    setError(null);
    setModels(null);
    try {
      const role = configId ? (providers.find((p) => p.id === configId)?.role ?? form.role) : form.role;
      const body = configId
        ? { configId }
        : { name: form.name || 'ad-hoc', provider: form.provider, baseUrl: form.baseUrl || null, model: form.model || 'x', apiKey: form.apiKey };
      const result = await api<ProviderModelsDto>(`/api/admin/ai-providers/${role}/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setModels(result.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list models');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Role</th>
              <th className="th">Name</th>
              <th className="th">Provider</th>
              <th className="th">Model</th>
              <th className="th">API key</th>
              <th className="th">Primary</th>
              <th className="th">Active</th>
              <th className="th">Last test</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 && (
              <tr>
                <td className="td text-ink-500" colSpan={9}>
                  No providers configured. Uploads will return 503 AI_PROVIDER_NOT_CONFIGURED.
                </td>
              </tr>
            )}
            {providers.map((provider) => (
              <tr key={provider.id}>
                <td className="td">{provider.role}</td>
                <td className="td font-medium text-ink-800">{provider.name}</td>
                <td className="td">{provider.provider}</td>
                <td className="td">{provider.model}</td>
                {/* Always masked — the plaintext key never reaches the browser. */}
                <td className="td font-mono text-xs text-ink-500">{provider.apiKeyMasked}</td>
                <td className="td">{provider.isPrimary ? 'yes' : '—'}</td>
                <td className="td">{provider.isActive ? 'yes' : 'no'}</td>
                <td className="td text-xs">
                  {provider.lastTestedAt
                    ? `${provider.lastTestOk ? 'OK' : 'FAIL'} · ${new Date(provider.lastTestedAt).toLocaleString()}`
                    : 'never'}
                </td>
                <td className="td space-x-2 whitespace-nowrap text-right">
                  <button type="button" className="text-sm text-accent hover:underline" disabled={busy} onClick={() => void test(provider.id)}>
                    Test
                  </button>
                  <button type="button" className="text-sm text-accent hover:underline" disabled={busy} onClick={() => void listModels(provider.id)}>
                    Models
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold text-ink-900">Add or update a provider</h2>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="role">Role</label>
            <select id="role" className="input" value={form.role} onChange={(e) => set('role', e.target.value as FormState['role'])}>
              {ROLES.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="provider">Provider</label>
            <select id="provider" className="input" value={form.provider} onChange={(e) => set('provider', e.target.value as FormState['provider'])}>
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="openai-primary" />
          </div>
          <div>
            <label className="label" htmlFor="model">Model</label>
            <input id="model" className="input" required value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="gpt-4o-mini" />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="apiKey">API key (stored encrypted; leave blank to keep the existing key)</label>
            <input id="apiKey" className="input" type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="baseUrl">Base URL (optional)</label>
            <input id="baseUrl" className="input" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" />
          </div>
          <div>
            <label className="label" htmlFor="priority">Priority (lower runs first)</label>
            <input id="priority" className="input" type="number" min={0} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="timeoutMs">Timeout (ms)</label>
            <input id="timeoutMs" className="input" type="number" min={1000} value={form.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={form.isPrimary} onChange={(e) => set('isPrimary', e.target.checked)} />
            Primary for this role
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            Active
          </label>

          <div className="flex gap-2 md:col-span-2">
            <button type="submit" className="btn-primary" disabled={busy}>Save</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void test()}>Test before saving</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void listModels()}>List models</button>
          </div>
        </form>

        {message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        {models && (
          <div className="mt-4">
            <p className="text-sm font-medium text-ink-700">Available models ({models.length})</p>
            <p className="mt-1 max-h-40 overflow-auto rounded-lg bg-ink-50 p-3 font-mono text-xs text-ink-700">{models.join(', ')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
