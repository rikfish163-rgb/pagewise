import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminCredits, AdminCreditsHeading } from '@/components/AdminCredits';
import { localeCookieName, resolveLocale, translate } from '@/lib/i18n';
import { getSiteAccount } from '../../site-account';

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveLocale((await cookies()).get(localeCookieName)?.value);
  return { title: translate(locale, '积分管理 · 页边') };
}
export const dynamic = 'force-dynamic';

export default async function AdminCreditsPage() {
  const account = await getSiteAccount();
  if (!account?.admin) redirect('/');

  return (
    <main className="admin-credits">
      <AdminCreditsHeading/>
      <AdminCredits />
    </main>
  );
}
