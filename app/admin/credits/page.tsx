import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
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
        <Link href="/">‹ 返回页边</Link>
        <h1>积分管理</h1>
      </header>
      <AdminCredits />
    </main>
  );
}
