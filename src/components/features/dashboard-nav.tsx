'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

interface Session {
  userId: string;
  email: string;
}

export function DashboardNav(): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data?.data) {
          setSession(data.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleLogout = async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setSession(null);
    window.location.href = '/login';
  };

  if (loading) {
    return <span className="text-sm text-muted-foreground">Loading…</span>;
  }

  if (!session) {
    return (
      <div className="flex items-center gap-2">
        <ThemeToggle variant="ghost" size="icon" />
        <Link href="/login">
          <Button variant="secondary" size="sm">
            Log in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <ThemeToggle variant="ghost" size="icon" />
      <span className="text-sm text-muted-foreground">{session.email}</span>
      <Button variant="secondary" size="sm" onClick={handleLogout}>
        Log out
      </Button>
    </div>
  );
}
