'use client';

import { ThemeToggle } from '@/components/theme-toggle';

export function AuthHeader(): React.ReactElement {
  return (
    <header className="absolute top-4 right-4">
      <ThemeToggle variant="ghost" size="icon" />
    </header>
  );
}
