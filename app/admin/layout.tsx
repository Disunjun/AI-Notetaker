import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

/**
 * The admin layout does NOT enforce authentication, because /admin/login lives
 * inside it. Each protected page checks the admin session itself.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
