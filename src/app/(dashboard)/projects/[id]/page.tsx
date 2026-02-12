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
import { cn } from '@/lib/utils';
import { ProjectTerminal } from '@/components/features/terminal';
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
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Deployment {
  id: string;
  status: string;
  subdomain: string | null;
  containerPort: number | null;
  buildStep: string | null;
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
  createdAt: string;
  updatedAt: string;
  deployments: Deployment[];
}

type FrameworkType = 'STATIC' | 'NODEJS' | 'NEXTJS' | 'DJANGO';
type Tab = 'overview' | 'settings' | 'advanced';

const FRAMEWORK_KEYS: FrameworkType[] = ['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO'];
const POLL_INTERVAL_MS = 2500;

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
// DeploymentRow
// ---------------------------------------------------------------------------

function DeploymentRow({ deployment }: { deployment: Deployment }): React.ReactElement {
  const isInProgress = deployment.status === 'QUEUED' || deployment.status === 'BUILDING';
  const isFinished = deployment.status === 'DEPLOYED' || deployment.status === 'FAILED';

  const buildDuration =
    isFinished && deployment.startedAt && deployment.completedAt
      ? new Date(deployment.completedAt).getTime() - new Date(deployment.startedAt).getTime()
      : null;

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
          <div className="flex items-center gap-2 mt-0.5">
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
          </div>
          {isInProgress && deployment.status === 'BUILDING' && (
            <BuildProgress currentStep={deployment.buildStep} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
  { key: 'advanced', label: 'Advanced', icon: <Terminal className="h-4 w-4" /> },
];

function Sidebar({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }): React.ReactElement {
  return (
    <nav className="flex flex-row gap-1 lg:flex-col lg:gap-0.5 lg:w-48 lg:shrink-0">
      {TABS.map(({ key, label, icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left',
            'hover:bg-muted',
            active === key
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground'
          )}
        >
          {icon}
          {label}
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
  const framework =
    project.type === 'STATIC' || project.type === 'NODEJS' || project.type === 'NEXTJS' || project.type === 'DJANGO'
      ? project.type
      : 'STATIC';

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [type, setType] = useState<FrameworkType>(framework);
  const [branch, setBranch] = useState(project.branch ?? 'main');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sync local form state when the project prop changes (e.g. after save + refetch)
  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
    setType(framework);
    setBranch(project.branch ?? 'main');
  }, [project.id, project.name, project.description, project.branch, framework]);

  const hasChanges = name !== project.name || description !== (project.description ?? '') || type !== framework || branch !== (project.branch ?? 'main');

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
                      onClick={() => setType(key)}
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

function OverviewPanel({
  project,
  deployError,
  isInProgress,
}: {
  project: ProjectDetail;
  deploying: boolean;
  deployError: string | null;
  isInProgress: boolean;
  onDeploy: () => void;
}): React.ReactElement {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [localIP, setLocalIP] = useState<string | null>(null);

  const framework =
    project.type === 'STATIC' || project.type === 'NODEJS' || project.type === 'NEXTJS' || project.type === 'DJANGO'
      ? project.type
      : 'STATIC';

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
              <span className="text-sm">{project.source}</span>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Branch</p>
              <span className="inline-flex items-center gap-1.5 text-sm font-mono">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                {project.branch}
              </span>
            </div>
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

      {/* Deployments */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Deployments</CardTitle>
            <span className="text-xs text-muted-foreground">
              {project.deployments.length} deployment{project.deployments.length !== 1 ? 's' : ''}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {project.deployments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Rocket className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No deployments yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click &quot;Deploy&quot; to create your first deployment.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {project.deployments.map((deployment) => (
                <DeploymentRow key={deployment.id} deployment={deployment} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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

  const { execute: executeDeploy, loading: deploying, error: deployError, reset: resetDeploy } = useFetchMutation();

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

  // Poll when a deployment is in progress
  useEffect(() => {
    const hasInProgress = project?.deployments.some(
      (d) => d.status === 'QUEUED' || d.status === 'BUILDING'
    );

    if (!hasInProgress) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      fetch(`/api/projects/${params.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && data.data) {
            setProject(data.data);
          }
        })
        .catch(() => { });
    }, POLL_INTERVAL_MS);

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
      if (result) fetchProject();
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

  const framework =
    project.type === 'STATIC' || project.type === 'NODEJS' || project.type === 'NEXTJS' || project.type === 'DJANGO'
      ? project.type
      : 'STATIC';
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
              <h2 className="text-2xl font-bold truncate">{project.name}</h2>
              <FrameworkLogo framework={framework} size={22} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              /{project.slug} &middot; Created {formatDate(project.createdAt)}
            </p>
          </div>
        </div>
        <Button
          onClick={handleDeploy}
          disabled={deploying || isInProgress}
          className="shrink-0"
        >
          {deploying || isInProgress ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Rocket className="mr-2 h-4 w-4" />
          )}
          {deploying ? 'Deploying…' : isInProgress ? 'In progress…' : 'Deploy'}
        </Button>
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
