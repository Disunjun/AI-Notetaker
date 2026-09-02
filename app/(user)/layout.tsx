import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { resolveUser } from '@/lib/auth/sessions';
import { UserNav } from '@/components/UserNav';

export const dynamic = 'force-dynamic';

export default async function UserLayout({ children }: { children: ReactNode }) {
  const user = await resolveUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <UserNav email={user.email} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
