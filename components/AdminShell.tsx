'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const LINKS = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/ai-providers', label: 'AI providers' },
  { href: '/admin/resend', label: 'Resend' },
  { href: '/admin/jobs', label: 'Jobs' },
  { href: '/admin/usage', label: 'Usage' },
  { href: '/admin/email-logs', label: 'Email logs' },
  { href: '/admin/queue-health', label: 'Queue health' },
];

export function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    router.push('/admin/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-100 bg-ink-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-lg font-semibold">AI Notetaker · Admin</span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-300">{email}</span>
            <button type="button" className="btn-secondary" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
                pathname === link.href ? 'bg-accent text-white' : 'text-ink-300 hover:bg-ink-800'
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
