'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FrameworkLogo, FRAMEWORK_CONFIG, getProjectUrl } from '@/components/ui/framework-logo';
import { useFetchMutation } from '@/hooks/use-fetch-mutation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ProjectTerminal } from '@/components/features/terminal';
import { EnvVarsPanel } from '@/components/features/env-vars-panel';
import { AccessListPanel } from '@/components/features/access-list-panel';
import { DomainsPanel } from '@/components/features/domains-panel';
import { getLocalIP } from '@/lib/local-ip';
import {
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
  Globe,
  Github,
  Clock,
  Rocket,
  Loader2,
  CheckCircle2,
  XCircle,
  Timer,
  Hammer,
  LayoutDashboard,
  Settings,
  Trash2,
  Terminal,
  Wifi,
  GitBranch,
  KeyRound,
  ChevronDown,
  ChevronUp,
  BarChart2,
  TrendingUp,
  Activity,
  Zap,
  BookOpen,
  Lock,
} from 'lucide-react';
import { PublishPanel } from '@/components/features/publish-panel';
import { ReuploadCard } from '@/components/features/reupload-card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Deployment {
  id: string;
  status: string;
  subdomain: string | null;
  containerPort: number | null;
  buildStep: string | null;
  buildLog: string | null;
  commitHash: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  source: string;
  type: string;
  githubUrl: string | null;
  branch: string;
  isPrivate: boolean;
  useStaticHosting: boolean;
  autoDeploy: boolean;
  createdAt: string;
  updatedAt: string;
  deployments: Deployment[];
}

type FrameworkType = 'STATIC' | 'NODEJS' | 'NEXTJS' | 'DJANGO' | 'REACT' | 'FASTAPI' | 'FLASK' | 'VUE' | 'SVELTE';
type Tab = 'overview' | 'deployments' | 'analytics' | 'env' | 'domains' | 'settings' | 'advanced' | 'publish';

interface TrafficData {
  totalHits: number;
  hitsThisWeek: number;
  hitsByDay: { date: string; count: number }[];
  deviceBreakdown: { mobile: number; desktop: number; bot: number; unknown: number };
}

interface AnalyticsData {
  totalDeployments: number;
  deploysThisWeek: number;
  successRate: number | null;
  avgBuildMs: number | null;
  liveSinceMs: number | null;
  deploysByDay: { date: string; total: number; succeeded: number; failed: number }[];
  recentBuildTimes: { createdAt: string; durationMs: number; status: string }[];
  traffic: TrafficData | null;
}

const FRAMEWORK_KEYS: FrameworkType[] = ['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO', 'REACT', 'FASTAPI', 'FLASK', 'VUE', 'SVELTE'];
const POLL_INTERVAL_MS = 2500;
const LOCKED_STATIC_TYPES = ['STATIC', 'REACT', 'VUE', 'SVELTE'] as const;
const STATIC_ELIGIBLE_TYPES = [...LOCKED_STATIC_TYPES, 'NEXTJS'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: string }): React.ReactElement {
  switch (status) {
    case 'DEPLOYED':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'FAILED':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'BUILDING':
      return <Hammer className="h-4 w-4 text-yellow-500" />;
    case 'QUEUED':
      return <Timer className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const variant =
    status === 'DEPLOYED'
      ? 'secondary'
      : status === 'FAILED'
        ? 'destructive'
        : 'outline';

  return (
    <Badge variant={variant} className="text-xs font-normal">
      <StatusIcon status={status} />
      <span className="ml-1.5">{status.charAt(0) + status.slice(1).toLowerCase()}</span>
    </Badge>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

const BUILD_STEPS = [
  { key: 'CLONING', label: 'Cloning' },
  { key: 'SCANNING', label: 'Scanning' },
  { key: 'BUILDING_IMAGE', label: 'Building' },
  { key: 'STARTING', label: 'Starting' },
] as const;

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  return `${min}m ${remainSec}s`;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00'); // noon to avoid UTC-offset day-shift
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatLiveDuration(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days > 0) return `${days}d`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(ms / (60 * 1000));
  return `${Math.max(minutes, 1)}m`;
}

function ElapsedTimer({ since }: { since: string }): React.ReactElement {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(since).getTime());

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Date.now() - new Date(since).getTime());
    }, 1000);
    return () => clearInterval(id);
  }, [since]);

  return <span className="tabular-nums">{formatDuration(elapsed)}</span>;
}

function BuildProgress({ currentStep }: { currentStep: string | null }): React.ReactElement {
  const currentIdx = BUILD_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center gap-1.5 mt-2">
      {BUILD_STEPS.map((step, i) => {
        const isDone = currentIdx > i;
        const isActive = currentIdx === i;
        return (
          <div key={step.key} className="flex items-center gap-1.5">
            {i > 0 && (
              <div className={cn('h-px w-4', isDone || isActive ? 'bg-yellow-500' : 'bg-muted-foreground/30')} />
            )}
            <div className="flex items-center gap-1">
              {isDone ? (
                <CheckCircle2 className="h-3 w-3 text-green-500" />
              ) : isActive ? (
                <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
              ) : (
                <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />
              )}
              <span
                className={cn(
                  'text-xs',
                  isActive ? 'text-foreground font-medium' : isDone ? 'text-muted-foreground' : 'text-muted-foreground/50'
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeploymentLogs
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['DEPLOYED', 'FAILED', 'CANCELLED']);

function DeploymentLogs({ deployment, projectId }: { deployment: Deployment; projectId: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const isTerminal = TERMINAL_STATUSES.has(deployment.status);

  useEffect(() => {
    if (!open) {
      // Clean up SSE on close
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      return;
    }

    setLines('');
    setLoading(true);

    if (isTerminal) {
      // Fetch static log from REST
      fetch(`/api/projects/${projectId}/deployments/${deployment.id}/logs`)
        .then((res) => res.json())
        .then((data) => {
          setLines(data?.data?.buildLog ?? '');
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }

    // Active deployment — use SSE
    const es = new EventSource(`/api/projects/${projectId}/deployments/${deployment.id}/logs/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; log?: string; text?: string };
        if (msg.type === 'existing' && msg.log) {
          setLines(msg.log);
          setLoading(false);
        } else if (msg.type === 'line' && msg.text) {
          setLines((prev) => prev + msg.text);
          setLoading(false);
        } else if (msg.type === 'done') {
          es.close();
          esRef.current = null;
          setLoading(false);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setLoading(false);
      es.close();
      esRef.current = null;
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [open, deployment.id, deployment.status, isTerminal, projectId]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, open]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1.5 px-4 pb-2"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? 'Hide logs' : 'View logs'}
      </button>

      {open && (
        <div className="mx-4 mb-3 rounded-md bg-zinc-950 border border-zinc-800 overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-3 font-mono text-xs leading-relaxed text-zinc-300">
            {loading && lines === '' && (
              <span className="text-zinc-500">Loading logs…</span>
            )}
            {lines === '' && !loading && (
              <span className="text-zinc-500">No log output yet.</span>
            )}
            <pre className="whitespace-pre-wrap break-all">{lines}</pre>
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeploymentRow
// ---------------------------------------------------------------------------

function DeploymentRow({
  deployment,
  projectId,
  branch,
  isDeployInProgress,
  onRetried,
  source,
}: {
  deployment: Deployment;
  projectId: string;
  branch: string;
  isDeployInProgress: boolean;
  onRetried: () => void;
  source?: string;
}): React.ReactElement {
  const isUpload = source === 'UPLOAD';
  const isInProgress = deployment.status === 'QUEUED' || deployment.status === 'BUILDING';
  const isFinished = deployment.status === 'DEPLOYED' || deployment.status === 'FAILED';
  const isFailed = deployment.status === 'FAILED';
  const canCancel = deployment.status === 'QUEUED';
  const canRedeploy = deployment.status === 'DEPLOYED' || deployment.status === 'CANCELLED';

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [redeploying, setRedeploying] = useState(false);
  const [redeployError, setRedeployError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const buildDuration =
    isFinished && deployment.startedAt && deployment.completedAt
      ? new Date(deployment.completedAt).getTime() - new Date(deployment.startedAt).getTime()
      : null;

  const handleRetry = async (): Promise<void> => {
    setRetryError(null);
    setRetrying(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/deployments/${deployment.id}/retry`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        setRetryError(data?.error?.message ?? 'Retry failed');
      } else {
        onRetried();
      }
    } catch {
      setRetryError('Something went wrong');
    } finally {
      setRetrying(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    setCancelError(null);
    setCancelling(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/deployments/${deployment.id}/cancel`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        setCancelError(data?.error?.message ?? 'Cancel failed');
      } else {
        onRetried();
      }
    } catch {
      setCancelError('Something went wrong');
    } finally {
      setCancelling(false);
    }
  };

  const handleRedeploy = async (): Promise<void> => {
    setRedeployError(null);
    setRedeploying(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/deploy`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setRedeployError(data?.error?.message ?? 'Redeploy failed');
      } else {
        onRetried();
      }
    } catch {
      setRedeployError('Something went wrong');
    } finally {
      setRedeploying(false);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        {isInProgress ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-yellow-500" />
        ) : (
          <StatusIcon status={deployment.status} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {deployment.id.slice(0, 8)}
            </span>
            <StatusBadge status={deployment.status} />
          </div>
          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
            <p className="text-xs text-muted-foreground">
              {formatRelative(deployment.createdAt)} &middot; {formatDate(deployment.createdAt)}
            </p>
            {isInProgress && deployment.startedAt && (
              <span className="text-xs text-yellow-600 font-medium">
                <ElapsedTimer since={deployment.startedAt} />
              </span>
            )}
            {buildDuration !== null && (
              <span className="text-xs text-muted-foreground">
                &middot; {formatDuration(buildDuration)}
              </span>
            )}
            {!isUpload && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                &middot; <GitBranch className="h-3 w-3" />{branch}
              </span>
            )}
            {!isUpload && deployment.commitHash && (
              <span className="text-xs font-mono text-muted-foreground">
                &middot; {deployment.commitHash.slice(0, 7)}
              </span>
            )}
          </div>
          {isInProgress && deployment.status === 'BUILDING' && (
            <BuildProgress currentStep={deployment.buildStep} />
          )}
          {cancelError && (
            <p className="text-xs text-destructive mt-1">{cancelError}</p>
          )}
          {retryError && (
            <p className="text-xs text-destructive mt-1">{retryError}</p>
          )}
          {redeployError && (
            <p className="text-xs text-destructive mt-1">{redeployError}</p>
          )}
        </div>
        {canCancel && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-7 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => { void handleCancel(); }}
            disabled={cancelling}
          >
            {cancelling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              'Cancel'
            )}
          </Button>
        )}
        {isFailed && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-7 px-2 text-xs"
            onClick={() => { void handleRetry(); }}
            disabled={retrying}
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              'Retry'
            )}
          </Button>
        )}
        {canRedeploy && !isUpload && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-7 px-2 text-xs"
            onClick={() => { void handleRedeploy(); }}
            disabled={redeploying || isDeployInProgress}
            title={isDeployInProgress ? 'A deployment is already in progress' : 'Redeploy from latest commit'}
          >
            {redeploying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              'Redeploy'
            )}
          </Button>
        )}
      </div>
      <DeploymentLogs deployment={deployment} projectId={projectId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub?: string;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <p className="text-xs uppercase tracking-wide">{label}</p>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function FrequencyChart({
  days,
}: {
  days: { date: string; total: number; succeeded: number; failed: number }[];
}): React.ReactElement {
  const maxCount = Math.max(...days.map((d) => d.total), 1);
  return (
    <div>
      <div className="flex items-end gap-0.5 sm:gap-1 h-20">
        {days.map((day) => {
          const heightPct = day.total > 0 ? Math.max((day.total / maxCount) * 100, 8) : 0;
          const barColor =
            day.total === 0
              ? ''
              : day.failed === 0
                ? 'bg-green-500'
                : day.succeeded === 0
                  ? 'bg-destructive'
                  : 'bg-yellow-500';
          return (
            <div key={day.date} className="flex-1 relative group flex flex-col justify-end h-full">
              {day.total > 0 ? (
                <div
                  className={cn('w-full rounded-t-sm transition-opacity group-hover:opacity-70', barColor)}
                  style={{ height: `${heightPct}%` }}
                />
              ) : (
                <div className="w-full bg-border rounded-sm" style={{ height: '2px' }} />
              )}
              {day.total > 0 && (
                <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 bg-popover border rounded px-2 py-1 text-xs whitespace-nowrap shadow pointer-events-none">
                  <span className="font-medium">{formatShortDate(day.date)}</span>
                  <span>{day.total} deploy{day.total !== 1 ? 's' : ''}</span>
                  {day.succeeded > 0 && <span className="text-green-600">{day.succeeded} ok</span>}
                  {day.failed > 0 && <span className="text-destructive">{day.failed} failed</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5 sm:gap-1 mt-1">
        {days.map((day, i) => (
          <div key={day.date} className="flex-1 text-center">
            {(i === 0 || i === 6 || i === 13) && (
              <span className="text-xs text-muted-foreground">{formatShortDate(day.date)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BuildTimeChart({
  builds,
}: {
  builds: { createdAt: string; durationMs: number; status: string }[];
}): React.ReactElement {
  const maxMs = Math.max(...builds.map((b) => b.durationMs), 1);
  return (
    <div className="flex items-end gap-0.5 sm:gap-1 h-20">
      {builds.map((build, i) => {
        const heightPct = Math.max((build.durationMs / maxMs) * 100, 8);
        const isOk = build.status === 'DEPLOYED';
        return (
          <div key={i} className="flex-1 relative group flex flex-col justify-end h-full">
            <div
              className={cn(
                'w-full rounded-t-sm transition-opacity group-hover:opacity-70',
                isOk ? 'bg-green-500' : 'bg-destructive'
              )}
              style={{ height: `${heightPct}%` }}
            />
            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 bg-popover border rounded px-2 py-1 text-xs whitespace-nowrap shadow pointer-events-none">
              <span className="font-medium">{formatDuration(build.durationMs)}</span>
              <span className={isOk ? 'text-green-600' : 'text-destructive'}>
                {build.status.toLowerCase()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrafficChart({ days }: { days: { date: string; count: number }[] }): React.ReactElement {
  const maxCount = Math.max(...days.map((d) => d.count), 1);
  return (
    <div>
      <div className="flex items-end gap-0.5 sm:gap-1 h-20">
        {days.map((day) => {
          const heightPct = day.count > 0 ? Math.max((day.count / maxCount) * 100, 8) : 0;
          return (
            <div key={day.date} className="flex-1 relative group flex flex-col justify-end h-full">
              {day.count > 0 ? (
                <div
                  className="w-full rounded-t-sm bg-blue-500 transition-opacity group-hover:opacity-70"
                  style={{ height: `${heightPct}%` }}
                />
              ) : (
                <div className="w-full bg-border rounded-sm" style={{ height: '2px' }} />
              )}
              {day.count > 0 && (
                <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 bg-popover border rounded px-2 py-1 text-xs whitespace-nowrap shadow pointer-events-none">
                  <span className="font-medium">{formatShortDate(day.date)}</span>
                  <span>{day.count} visit{day.count !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5 sm:gap-1 mt-1">
        {days.map((day, i) => (
          <div key={day.date} className="flex-1 text-center">
            {(i === 0 || i === 6 || i === 13) && (
              <span className="text-xs text-muted-foreground">{formatShortDate(day.date)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/analytics`)
      .then((res) => res.json())
      .then((json: { success: boolean; data?: AnalyticsData; error?: { message: string } }) => {
        if (json.success && json.data) setData(json.data);
        else setError(json.error?.message ?? 'Failed to load analytics');
      })
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analytics</CardTitle>
          <CardDescription>{error ?? 'Failed to load'}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const successPct =
    data.successRate !== null ? `${Math.round(data.successRate * 100)}%` : '—';
  const avgBuild = data.avgBuildMs !== null ? formatDuration(data.avgBuildMs) : '—';

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total deploys"
          value={data.totalDeployments}
          icon={<Rocket className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="This week"
          value={data.deploysThisWeek}
          icon={<Activity className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Success rate"
          value={successPct}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          sub={data.successRate !== null ? `${Math.round(data.successRate * 100)}% of finished builds` : undefined}
        />
        <StatCard
          label="Avg build"
          value={avgBuild}
          icon={<Zap className="h-3.5 w-3.5" />}
          sub="for successful deploys"
        />
      </div>

      {/* Live since */}
      {data.liveSinceMs !== null && (
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-green-500 shrink-0 animate-pulse" />
              <div>
                <p className="text-sm font-medium">Live for {formatLiveDuration(data.liveSinceMs)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last successful deployment completed {formatLiveDuration(data.liveSinceMs)} ago
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deploy frequency */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Deploy frequency</CardTitle>
          <CardDescription>Deployments per day over the last 14 days</CardDescription>
        </CardHeader>
        <CardContent>
          <FrequencyChart days={data.deploysByDay} />
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />
              All succeeded
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-500" />
              Mixed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-destructive" />
              All failed
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Build time trend */}
      {data.recentBuildTimes.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Build time trend</CardTitle>
            <CardDescription>
              Duration of the last {data.recentBuildTimes.length} finished build{data.recentBuildTimes.length !== 1 ? 's' : ''}, oldest to newest
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BuildTimeChart builds={data.recentBuildTimes} />
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />
                Succeeded
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-destructive" />
                Failed
              </span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Build time trend</CardTitle>
            <CardDescription>No finished builds in the last 30 days.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Traffic */}
      {data.traffic ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Total visits"
              value={data.traffic.totalHits.toLocaleString()}
              icon={<Wifi className="h-3.5 w-3.5" />}
              sub="via proxy (all time)"
            />
            <StatCard
              label="This week"
              value={data.traffic.hitsThisWeek.toLocaleString()}
              icon={<Activity className="h-3.5 w-3.5" />}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Traffic (14 days)</CardTitle>
              <CardDescription>Unique proxy requests per day to your deployed app</CardDescription>
            </CardHeader>
            <CardContent>
              {data.traffic.totalHits === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No traffic recorded yet — visits to your deployed app will appear here.
                </p>
              ) : (
                <TrafficChart days={data.traffic.hitsByDay} />
              )}
            </CardContent>
          </Card>

          {data.traffic.totalHits > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Device breakdown</CardTitle>
                <CardDescription>All-time visitor device distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(
                    [
                      { key: 'desktop', label: 'Desktop' },
                      { key: 'mobile', label: 'Mobile' },
                      { key: 'bot', label: 'Bot / Crawler' },
                      { key: 'unknown', label: 'Unknown' },
                    ] as { key: keyof TrafficData['deviceBreakdown']; label: string }[]
                  ).map(({ key, label }) => {
                    const count = data.traffic!.deviceBreakdown[key];
                    const pct = data.traffic!.totalHits > 0
                      ? Math.round((count / data.traffic!.totalHits) * 100)
                      : 0;
                    if (count === 0) return null;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground w-12 text-right">
                          {pct}% ({count.toLocaleString()})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'deployments', label: 'Deployments', icon: <Rocket className="h-4 w-4" /> },
  { key: 'analytics', label: 'Analytics', icon: <BarChart2 className="h-4 w-4" /> },
  { key: 'env', label: 'Environment', icon: <KeyRound className="h-4 w-4" /> },
  { key: 'domains', label: 'Domains', icon: <Globe className="h-4 w-4" /> },
  { key: 'publish', label: 'Publish', icon: <BookOpen className="h-4 w-4" /> },
  { key: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
  { key: 'advanced', label: 'Advanced', icon: <Terminal className="h-4 w-4" /> },
];

function Sidebar({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }): React.ReactElement {
  return (
    <nav className="flex flex-row flex-wrap gap-1 lg:flex-col lg:flex-nowrap lg:gap-0.5 lg:w-48 lg:shrink-0">
      {TABS.map(({ key, label, icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          aria-label={label}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left',
            'hover:bg-muted',
            active === key
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground'
          )}
        >
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

function SettingsPanel({
  project,
  onUpdated,
}: {
  project: ProjectDetail;
  onUpdated: () => void;
}): React.ReactElement {
  const router = useRouter();
  const framework = (project.type in FRAMEWORK_CONFIG ? project.type : 'STATIC') as FrameworkType;

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [type, setType] = useState<FrameworkType>(framework);
  const [branch, setBranch] = useState(project.branch ?? 'main');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [isPrivate, setIsPrivate] = useState(project.isPrivate);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  const [autoDeploy, setAutoDeploy] = useState(project.autoDeploy);
  const [autoDeploySaving, setAutoDeploySaving] = useState(false);
  const [autoDeployError, setAutoDeployError] = useState<string | null>(null);

  const [useStaticHosting, setUseStaticHosting] = useState(project.useStaticHosting);

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sync local form state when the project prop changes (e.g. after save + refetch)
  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
    setType(framework);
    setBranch(project.branch ?? 'main');
    setIsPrivate(project.isPrivate);
    setAutoDeploy(project.autoDeploy);
  }, [project.id, project.name, project.description, project.branch, project.isPrivate, project.autoDeploy, framework]);

  const isStaticEligible = (STATIC_ELIGIBLE_TYPES as readonly string[]).includes(type);
  const isLockedStatic = (LOCKED_STATIC_TYPES as readonly string[]).includes(type);
  const hasChanges =
    name !== project.name ||
    description !== (project.description ?? '') ||
    type !== framework ||
    branch !== (project.branch ?? 'main') ||
    (type === 'NEXTJS' && useStaticHosting !== project.useStaticHosting);

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);

    if (name.trim().length < 3) {
      setSaveError('Project name must be at least 3 characters');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          type,
          branch: branch.trim() || 'main',
          useStaticHosting: isStaticEligible ? useStaticHosting : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data?.error?.message ?? 'Failed to save');
      } else {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        onUpdated();
      }
    } catch {
      setSaveError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const handlePrivacyToggle = async (next: boolean): Promise<void> => {
    setPrivacyError(null);
    setPrivacySaving(true);
    setIsPrivate(next);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrivate: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIsPrivate(!next); // revert on failure
        setPrivacyError(data?.error?.message ?? 'Failed to update');
      } else {
        onUpdated();
      }
    } catch {
      setIsPrivate(!next);
      setPrivacyError('Something went wrong');
    } finally {
      setPrivacySaving(false);
    }
  };

  const handleAutoDeployToggle = async (next: boolean): Promise<void> => {
    setAutoDeployError(null);
    setAutoDeploySaving(true);
    setAutoDeploy(next);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoDeploy: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAutoDeploy(!next); // revert on failure
        setAutoDeployError(data?.error?.message ?? 'Failed to update');
      } else {
        onUpdated();
      }
    } catch {
      setAutoDeploy(!next);
      setAutoDeployError('Something went wrong');
    } finally {
      setAutoDeploySaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data?.error?.message ?? 'Failed to delete');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setDeleteError('Something went wrong');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>Update your project name, description, and framework.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="settings-name">Project name</Label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={3}
                maxLength={50}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="settings-description">Description</Label>
              <Textarea
                id="settings-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Brief description of the project"
              />
              <p className="text-xs text-muted-foreground">{description.length}/500</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="settings-branch">Branch</Label>
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  id="settings-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  maxLength={100}
                />
              </div>
              <p className="text-xs text-muted-foreground">The git branch to deploy. Changing this and redeploying will switch to the new branch.</p>
            </div>

            <div className="space-y-2">
              <Label>Framework</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="group" aria-label="Framework">
                {FRAMEWORK_KEYS.map((key) => {
                  const config = FRAMEWORK_CONFIG[key];
                  const { Logo, label, description: desc } = config;
                  const isSelected = type === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setType(key);
                        if ((LOCKED_STATIC_TYPES as readonly string[]).includes(key)) {
                          setUseStaticHosting(true);
                        }
                      }}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-center transition-colors',
                        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : 'border-input bg-card'
                      )}
                      aria-pressed={isSelected}
                      aria-label={`${label} – ${desc}`}
                    >
                      <Logo size={32} className="shrink-0" />
                      <span className="text-xs font-medium">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {isStaticEligible && (
              type === 'NEXTJS' ? (
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Static export</p>
                    <p className="text-xs text-muted-foreground">
                      Builds as static HTML/CSS/JS — no server, no RAM, instant load. Disable only if you need API routes or server-side rendering.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useStaticHosting}
                    onClick={() => setUseStaticHosting(!useStaticHosting)}
                    className={cn(
                      'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                      useStaticHosting ? 'bg-primary' : 'bg-input'
                    )}
                  >
                    <span className={cn(
                      'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
                      useStaticHosting ? 'translate-x-5' : 'translate-x-0'
                    )} />
                  </button>
                </div>
              ) : isLockedStatic && (
                <div className="flex items-center justify-between rounded-lg border p-4 opacity-90">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Static hosting</p>
                    <p className="text-xs text-muted-foreground">
                      Optimized for this framework. Always enabled.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={true}
                    disabled
                    className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-primary opacity-70 transition-colors"
                  >
                    <span className="pointer-events-none block h-5 w-5 translate-x-5 rounded-full bg-background shadow-lg ring-0 transition-transform" />
                  </button>
                </div>
              )
            )}

            {saveError && (
              <p className="text-sm text-destructive" role="alert">{saveError}</p>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving || !hasChanges}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : saveSuccess ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Saved
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
              {!hasChanges && (
                <span className="text-xs text-muted-foreground">No changes</span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Auto-deploy on git push — GitHub projects only */}
      {project.source === 'GITHUB' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Auto-Deploy</CardTitle>
            <CardDescription>
              When enabled, every push to the <span className="font-medium">{project.branch}</span> branch
              automatically triggers a new deployment. DropDeploy registers a webhook on your GitHub repository.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Deploy on push</p>
                  <p className="text-xs text-muted-foreground">
                    {autoDeploy
                      ? `Pushes to ${project.branch} will deploy automatically`
                      : 'Deployments are triggered manually'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoDeploy}
                disabled={autoDeploySaving}
                onClick={() => { void handleAutoDeployToggle(!autoDeploy); }}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                  autoDeploy ? 'bg-primary' : 'bg-input'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
                    autoDeploy ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
            {autoDeployError && (
              <p className="text-sm text-destructive mt-3" role="alert">{autoDeployError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Privacy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">URL Privacy</CardTitle>
          <CardDescription>
            When enabled, only the owner and people you grant access to can open the deployed URL.
            Manage who has access below. Public URLs remain accessible to everyone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Private URL</p>
                <p className="text-xs text-muted-foreground">
                  {isPrivate ? 'Only the owner and granted users can access this URL' : 'Anyone with the link can access this URL'}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPrivate}
              disabled={privacySaving}
              onClick={() => { void handlePrivacyToggle(!isPrivate); }}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                isPrivate ? 'bg-primary' : 'bg-input'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
                  isPrivate ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>
          {privacyError && (
            <p className="text-sm text-destructive mt-3" role="alert">{privacyError}</p>
          )}
        </CardContent>
      </Card>

      {/* Access list — only relevant while the URL is private */}
      {isPrivate && <AccessListPanel projectId={project.id} />}

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Permanently delete this project and all its deployments. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">
              Type <span className="font-mono font-semibold">{project.name}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={project.name}
            />
          </div>

          {deleteError && (
            <p className="text-sm text-destructive" role="alert">{deleteError}</p>
          )}

          <Button
            variant="destructive"
            disabled={deleteConfirm !== project.name || deleting}
            onClick={handleDelete}
          >
            {deleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete project
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdvancedPanel
// ---------------------------------------------------------------------------

function AdvancedPanel({ project }: { project: ProjectDetail }): React.ReactElement {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const latestDeployment = project.deployments[0];
  const isDeployed = latestDeployment?.status === 'DEPLOYED';
  const containerName = `dropdeploy-${project.slug}`;
  const imageName = `dropdeploy/${project.slug}:latest`;

  const handleCopyCommand = (command: string): void => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopiedCommand(command);
      setTimeout(() => setCopiedCommand(null), 2000);
    });
  };

  const commands = [
    {
      title: 'Access Container Shell',
      description: 'Execute bash inside the running container',
      command: `docker exec -it ${containerName} /bin/sh`,
    },
    {
      title: 'View Container Logs',
      description: 'Stream real-time logs from the container',
      command: `docker logs -f ${containerName}`,
    },
    {
      title: 'Inspect Container',
      description: 'View detailed container configuration',
      command: `docker inspect ${containerName}`,
    },
    {
      title: 'Container Stats',
      description: 'Monitor CPU and memory usage',
      command: `docker stats ${containerName}`,
    },
    {
      title: 'Restart Container',
      description: 'Restart the running container',
      command: `docker restart ${containerName}`,
    },
    {
      title: 'Stop Container',
      description: 'Stop the running container',
      command: `docker stop ${containerName}`,
    },
  ];

  return (
    <div className="space-y-6">
      {!isDeployed ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No Deployment</CardTitle>
            <CardDescription>
              Deploy your project first to access Docker connection details and debugging commands.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {/* Connection Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Container Details</CardTitle>
              <CardDescription>
                Information about your deployed Docker container
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Container Name
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                      {containerName}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleCopyCommand(containerName)}
                      title="Copy container name"
                    >
                      {copiedCommand === containerName ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Image Name
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                      {imageName}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleCopyCommand(imageName)}
                      title="Copy image name"
                    >
                      {copiedCommand === imageName ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                {latestDeployment.containerPort && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                      Host Port
                    </p>
                    <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                      {latestDeployment.containerPort}
                    </code>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Interactive Terminal */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Terminal</CardTitle>
              <CardDescription>
                Run commands inside your container's shell
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectTerminal projectId={project.id} containerName={containerName} />
            </CardContent>
          </Card>

          {/* Docker Commands */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Docker Commands</CardTitle>
              <CardDescription>
                Useful commands for debugging and managing your container
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {commands.map((cmd, idx) => (
                  <AccordionItem key={idx} value={`cmd-${idx}`}>
                    <AccordionTrigger className="text-sm hover:no-underline">
                      {cmd.title}
                    </AccordionTrigger>
                    <AccordionContent>
                      <p className="text-xs text-muted-foreground mb-2">
                        {cmd.description}
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded-md border overflow-x-auto">
                          {cmd.command}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => handleCopyCommand(cmd.command)}
                          title="Copy command"
                        >
                          {copiedCommand === cmd.command ? (
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>

          {/* Warning */}
          <Card className="border-yellow-500/50">
            <CardHeader>
              <CardTitle className="text-base text-yellow-600 dark:text-yellow-500">
                ⚠️ Important Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                • These commands require Docker CLI access on the host machine where the
                containers are running.
              </p>
              <p>
                • Container names are based on the project slug. If you redeploy, a new
                container may be created.
              </p>
              <p>
                • Use <code className="bg-muted px-1 py-0.5 rounded text-xs">docker ps</code> to
                verify the container is running.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverviewPanel
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DeploymentsPanel
// ---------------------------------------------------------------------------

function DeploymentsPanel({
  project,
  isInProgress,
  onRetried,
  onDeploy,
  deploying,
  deployMessage,
}: {
  project: ProjectDetail;
  isInProgress: boolean;
  onRetried: () => void;
  onDeploy: () => void;
  deploying: boolean;
  deployMessage: string | null;
}): React.ReactElement {
  const DEPLOYMENTS_PAGE_SIZE = 5;
  const [extraDeployments, setExtraDeployments] = useState<Deployment[]>([]);
  const [deploymentTotal, setDeploymentTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const firstDeploymentId = project.deployments[0]?.id;
  const prevFirstDeploymentIdRef = useRef<string | undefined>(firstDeploymentId);
  useEffect(() => {
    if (prevFirstDeploymentIdRef.current !== firstDeploymentId) {
      prevFirstDeploymentIdRef.current = firstDeploymentId;
      setExtraDeployments([]);
      setDeploymentTotal(null);
    }
  }, [firstDeploymentId]);

  const allDeployments = [...project.deployments, ...extraDeployments];
  const hasMoreDeployments =
    deploymentTotal !== null
      ? allDeployments.length < deploymentTotal
      : project.deployments.length >= DEPLOYMENTS_PAGE_SIZE;

  const loadMoreDeployments = async (): Promise<void> => {
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/deployments?skip=${allDeployments.length}&limit=${DEPLOYMENTS_PAGE_SIZE}`
      );
      const data = await res.json() as {
        success: boolean;
        data?: { deployments: Deployment[]; total: number };
        error?: { message: string };
      };
      if (!res.ok) {
        setLoadMoreError(data?.error?.message ?? 'Failed to load more');
      } else if (data.data) {
        setExtraDeployments((prev) => [...prev, ...data.data!.deployments]);
        setDeploymentTotal(data.data.total);
      }
    } catch {
      setLoadMoreError('Failed to load more deployments');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Deployments</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {deploymentTotal !== null
                ? `${allDeployments.length} of ${deploymentTotal}`
                : allDeployments.length}{' '}
              deployment{(deploymentTotal ?? allDeployments.length) !== 1 ? 's' : ''}
            </span>
            {project.source !== 'UPLOAD' && (
              <div className="flex flex-col items-end gap-1">
                <Button
                  size="sm"
                  onClick={onDeploy}
                  disabled={deploying}
                  title={isInProgress ? 'A build is running — clicking will queue a new deployment' : undefined}
                >
                  {deploying ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="mr-2 h-3.5 w-3.5" />
                  )}
                  {deploying ? 'Deploying…' : allDeployments.length === 0 ? 'Deploy' : 'Redeploy'}
                </Button>
                {deployMessage && (
                  <p className="text-xs text-muted-foreground">{deployMessage}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {allDeployments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Rocket className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No deployments yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Click &quot;Deploy&quot; to create your first deployment.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {allDeployments.map((deployment) => (
              <DeploymentRow
                key={deployment.id}
                deployment={deployment}
                projectId={project.id}
                branch={project.branch}
                isDeployInProgress={isInProgress}
                onRetried={onRetried}
                source={project.source}
              />
            ))}
            {hasMoreDeployments && (
              <div className="pt-1">
                {loadMoreError && (
                  <p className="text-xs text-destructive mb-1">{loadMoreError}</p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => { void loadMoreDeployments(); }}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Loading…</>
                  ) : (
                    'Load more'
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// OverviewPanel
// ---------------------------------------------------------------------------

function PrivateBadge(): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
      <Lock className="h-3 w-3" />
      Private
    </span>
  );
}

function OverviewPanel({
  project,
  deployError,
  isInProgress,
  onRetried,
}: {
  project: ProjectDetail;
  deploying: boolean;
  deployError: string | null;
  isInProgress: boolean;
  onDeploy: () => void;
  onRetried: () => void;
}): React.ReactElement {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [localIP, setLocalIP] = useState<string | null>(null);

  const framework = (project.type in FRAMEWORK_CONFIG ? project.type : 'STATIC') as FrameworkType;

  const latestDeployment = project.deployments[0];
  const isDeployed = latestDeployment?.status === 'DEPLOYED';
  const deployUrl = getProjectUrl(project.slug, latestDeployment?.containerPort ?? undefined);

  // Get local IP for network access
  useEffect(() => {
    if (isDeployed && latestDeployment?.containerPort) {
      getLocalIP().then(ip => {
        if (ip) {
          setLocalIP(ip);
        }
      });
    }
  }, [isDeployed, latestDeployment?.containerPort]);

  const localUrl = localIP && latestDeployment?.containerPort
    ? `http://${localIP}:${latestDeployment.containerPort}`
    : null;

  const handleCopyUrl = (url: string): void => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      {deployError && (
        <p className="text-sm text-destructive" role="alert">{deployError}</p>
      )}

      {/* Live URL banner */}
      {isDeployed && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
            <Globe className="h-4 w-4 shrink-0 text-green-500" />
            <span className="text-sm font-medium truncate flex-1" title={deployUrl}>
              {deployUrl}
            </span>
            {project.isPrivate && <PrivateBadge />}
            <StatusBadge status="DEPLOYED" />
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleCopyUrl(deployUrl)}
                title="Copy URL"
              >
                {copiedUrl ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                <a href={deployUrl} target="_blank" rel="noopener noreferrer" title="Open site">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>

          {/* Local Network URL */}
          {localUrl ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-2.5">
              <Wifi className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-0.5">
                  Local Network Access
                </p>
                <span className="text-xs font-mono truncate block" title={localUrl}>
                  {localUrl}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleCopyUrl(localUrl)}
                  title="Copy local URL"
                >
                  {copiedUrl ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                  <a href={localUrl} target="_blank" rel="noopener noreferrer" title="Open via local network">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Project details */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Project Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {project.description && (
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                <p className="text-sm">{project.description}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Framework</p>
              <FrameworkLogo framework={framework} size={20} showLabel />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Source</p>
              <span className="text-sm">{project.source === 'UPLOAD' ? 'File upload' : project.source}</span>
            </div>
            {project.source !== 'UPLOAD' && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Branch</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-mono">
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                  {project.branch}
                </span>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Status</p>
              <span className="text-sm">{isDeployed ? 'Live' : isInProgress ? 'Deploying' : 'Inactive'}</span>
            </div>
            {project.githubUrl && (
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Repository</p>
                <a
                  href={project.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <Github className="h-3.5 w-3.5" />
                  {project.githubUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
                </a>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Slug</p>
              <p className="text-sm font-mono">{project.slug}</p>
            </div>
            {latestDeployment?.containerPort && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Port</p>
                <p className="text-sm font-mono">{latestDeployment.containerPort}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Last Updated</p>
              <p className="text-sm">{formatDate(project.updatedAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Re-upload section for UPLOAD projects */}
      {project.source === 'UPLOAD' && (
        <ReuploadCard projectId={project.id} onSuccess={onRetried} disabled={isInProgress} />
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ProjectDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastedDeploymentsRef = useRef<Set<string>>(new Set());

  const { execute: executeDeploy, loading: deploying, error: deployError, reset: resetDeploy } = useFetchMutation();
  const [deployMessage, setDeployMessage] = useState<string | null>(null);

  const fetchProject = useCallback(() => {
    fetch(`/api/projects/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data.data) {
          setProject(data.data);
          setError(null);
        } else {
          setError(data?.error?.message ?? 'Project not found');
        }
      })
      .catch(() => setError('Failed to load project'))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  // Always poll — fast (2.5s) when a build is running, slow (5s) when idle.
  // This ensures externally triggered deployments (e.g. from the CLI) appear without a manual refresh.
  useEffect(() => {
    if (!project) return;

    const hasInProgress = project.deployments.some(
      (d) => d.status === 'QUEUED' || d.status === 'BUILDING'
    );
    const intervalMs = hasInProgress ? POLL_INTERVAL_MS : 5000;

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    pollRef.current = setInterval(() => {
      fetch(`/api/projects/${params.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && data.data) {
            const updated = data.data as ProjectDetail;
            setProject((prev) => {
              if (prev) {
                for (const dep of updated.deployments) {
                  const prev_dep = prev.deployments.find((d) => d.id === dep.id);
                  if (
                    prev_dep &&
                    (prev_dep.status === 'BUILDING' || prev_dep.status === 'QUEUED') &&
                    !toastedDeploymentsRef.current.has(dep.id)
                  ) {
                    if (dep.status === 'FAILED') {
                      toastedDeploymentsRef.current.add(dep.id);
                      toast.error('Build failed', {
                        description: `Deployment ${dep.id.slice(0, 8)} failed. Check the logs for details.`,
                      });
                    } else if (dep.status === 'DEPLOYED') {
                      toastedDeploymentsRef.current.add(dep.id);
                      toast.success('Deployed successfully', {
                        description: `Deployment ${dep.id.slice(0, 8)} is now live.`,
                      });
                    }
                  }
                }
              }
              return updated;
            });
          }
        })
        .catch(() => { });
    }, intervalMs);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [project?.deployments, params.id]);

  const handleDeploy = useCallback(() => {
    resetDeploy();
    void executeDeploy({
      url: `/api/projects/${params.id}/deploy`,
      method: 'POST',
    }).then((result) => {
      if (result) {
        fetchProject();
        const queued = (result.data as { data?: { queued?: boolean } })?.data?.queued;
        setDeployMessage(queued ? 'Queued — will start after current build.' : 'Deployment started.');
        setTimeout(() => setDeployMessage(null), 4000);
      }
    });
  }, [params.id, executeDeploy, resetDeploy, fetchProject]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error ?? 'Project not found'}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const framework = (project.type in FRAMEWORK_CONFIG ? project.type : 'STATIC') as FrameworkType;
  const latestDeployment = project.deployments[0];
  const isInProgress = latestDeployment?.status === 'QUEUED' || latestDeployment?.status === 'BUILDING';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 mt-1" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl sm:text-2xl font-bold truncate">{project.name}</h2>
              <FrameworkLogo framework={framework} size={22} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              /{project.slug} &middot; Created {formatDate(project.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Sidebar + Content */}
      <div className="flex flex-col gap-6 lg:flex-row">
        <Sidebar active={activeTab} onSelect={setActiveTab} />

        <div className="min-w-0 flex-1">
          {activeTab === 'overview' && (
            <OverviewPanel
              project={project}
              deploying={deploying}
              deployError={deployError}
              isInProgress={isInProgress}
              onDeploy={handleDeploy}
              onRetried={fetchProject}
            />
          )}
          {activeTab === 'deployments' && (
            <DeploymentsPanel
              project={project}
              isInProgress={isInProgress}
              onRetried={fetchProject}
              onDeploy={handleDeploy}
              deploying={deploying}
              deployMessage={deployMessage}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsPanel projectId={project.id} />
          )}
          {activeTab === 'env' && (
            <EnvVarsPanel projectId={project.id} />
          )}
          {activeTab === 'domains' && (
            <DomainsPanel projectId={project.id} />
          )}
          {activeTab === 'publish' && (
            <PublishPanel
              projectId={project.id}
              projectName={project.name}
              projectSlug={project.slug}
              defaultLiveUrl={isInProgress || !latestDeployment ? '' : getProjectUrl(project.slug, latestDeployment?.containerPort ?? undefined)}
              defaultRepoUrl={project.githubUrl ?? ''}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsPanel
              project={project}
              onUpdated={fetchProject}
            />
          )}
          {activeTab === 'advanced' && (
            <AdvancedPanel project={project} />
          )}
        </div>
      </div>
    </div>
  );
}
