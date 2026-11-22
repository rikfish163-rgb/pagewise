import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminCredits } from '@/components/AdminCredits';
import { getSiteAccount } from '../../site-account';

export const metadata: Metadata = { title: '积分管理 · 页边' };
export const dynamic = 'force-dynamic';

export default async function AdminCreditsPage() {
  const account = await getSiteAccount();
  if (!account?.admin) redirect('/');

  return (
    <main className="admin-credits">
      <header className="admin-credits-heading">
        <Link href="/#home">‹ 返回页边</Link>
        <h1>积分管理</h1>
      </header>
      <AdminCredits />
    </main>
  );
}
