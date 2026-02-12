import Link from 'next/link';
import { DashboardNav } from '@/components/features/dashboard-nav';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          <Link href="/dashboard">DropDeploy</Link>
        </h1>
        <DashboardNav />
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
