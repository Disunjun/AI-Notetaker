import { redirect } from 'next/navigation';
import { resolveUser } from '@/lib/auth/sessions';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await resolveUser();
  redirect(user ? '/dashboard' : '/login');
}
