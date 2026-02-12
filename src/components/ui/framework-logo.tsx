import { cn } from '@/lib/utils';
import { Globe, Server, Layers } from 'lucide-react';

const BASE_DOMAIN =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BASE_DOMAIN
    ? process.env.NEXT_PUBLIC_BASE_DOMAIN
    : 'dropdeploy.app';

/** True when app is running on localhost (dev); use port-based deploy URLs when available. */
function isLocalhostDev(): boolean {
  if (typeof process === 'undefined') return false;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return appUrl.includes('localhost') || process.env.NEXT_PUBLIC_USE_LOCALHOST_DEPLOY_URL === 'true';
}

const iconClass = 'shrink-0';

export const FRAMEWORK_CONFIG = {
  STATIC: {
    label: 'Static',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <img
        src="/assets/icons/html.svg"
        width={size}
        height={size}
        className={cn(iconClass, className)}
        alt="HTML"
        aria-hidden="true"
      />
    ),
    description: 'HTML / CSS / JS',
  },
  NODEJS: {
    label: 'Node.js',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <img
        src="/assets/icons/nodejs.svg"
        width={size}
        height={size}
        className={cn(iconClass, className)}
        alt="Node.js"
        aria-hidden="true"
      />
    ),
    description: 'Node.js',
  },
  NEXTJS: {
    label: 'Next.js',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <img
        src="/assets/icons/nextjs.svg"
        width={size}
        height={size}
        className={cn(iconClass, className)}
        alt="Next.js"
        aria-hidden="true"
      />
    ),
    description: 'Next.js',
  },
  DJANGO: {
    label: 'Django',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <img
        src="/assets/icons/django.svg"
        width={size}
        height={size}
        className={cn(iconClass, className)}
        alt="Django"
        aria-hidden="true"
      />
    ),
    description: 'Python / Django',
  },
} as const;

export interface FrameworkLogoProps {
  framework: 'STATIC' | 'NODEJS' | 'NEXTJS' | 'DJANGO';
  size?: number;
  className?: string;
  showLabel?: boolean;
}

export function FrameworkLogo({
  framework,
  size = 24,
  className,
  showLabel = false,
}: FrameworkLogoProps): React.ReactElement {
  const config = FRAMEWORK_CONFIG[framework] ?? FRAMEWORK_CONFIG.STATIC;
  const { Logo } = config;

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={config.label}>
      <Logo size={size} />
      {showLabel && <span className="text-sm font-medium">{config.label}</span>}
    </span>
  );
}

/**
 * Returns the public URL for a deployed project.
 * In localhost dev (NEXT_PUBLIC_APP_URL has localhost), uses http://localhost:<containerPort> when port is set.
 */
export function getProjectUrl(slug: string, containerPort?: number | null): string {
  if (containerPort != null && isLocalhostDev()) {
    return `http://localhost:${containerPort}`;
  }
  return `https://${slug}.${BASE_DOMAIN}`;
}
