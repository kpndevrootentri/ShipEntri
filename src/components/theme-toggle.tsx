'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ThemeValue = 'light' | 'dark' | 'system';

const options: { value: ThemeValue; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
  { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
];

export function ThemeToggle({
  className,
  variant = 'ghost',
  size = 'icon',
}: {
  className?: string;
  variant?: 'ghost' | 'outline' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}): React.ReactElement {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant={variant} size={size} className={cn(className)} disabled aria-hidden>
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const current = (theme ?? 'system') as ThemeValue;
  const cycleTheme = (): void => {
    const index = options.findIndex((o) => o.value === current);
    const next = options[(index + 1) % options.length];
    setTheme(next.value);
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={cycleTheme}
      className={cn(className)}
      title={`Theme: ${options.find((o) => o.value === current)?.label ?? current}. Click to cycle.`}
      aria-label={`Theme: ${current}. Switch to next theme.`}
    >
      {resolvedTheme === 'dark' ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </Button>
  );
}

/**
 * Dropdown-style theme selector (Light / Dark / System).
 */
export function ThemeSelect({ className }: { className?: string }): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <select
        className={cn(
          'h-9 w-[7rem] rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
          className
        )}
        defaultValue="system"
        aria-label="Theme"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    );
  }

  return (
    <select
      value={theme ?? 'system'}
      onChange={(e) => setTheme(e.target.value as ThemeValue)}
      className={cn(
        'h-9 w-[7rem] rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
        className
      )}
      aria-label="Theme"
    >
      <option value="light">Light</option>
      <option value="dark">Dark</option>
      <option value="system">System</option>
    </select>
  );
}
