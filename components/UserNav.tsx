'use client';

import { useRouter } from 'next/navigation';

export function UserNav({ email }: { email: string }) {
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    router.push('/login');
    router.refresh();
  };

  return (
    <header className="border-b border-ink-100 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <a href="/dashboard" className="text-lg font-semibold text-ink-900">AI Notetaker</a>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-500">{email}</span>
          <button type="button" className="btn-secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
