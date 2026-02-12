'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FrameworkLogo, getProjectUrl } from '@/components/ui/framework-logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Copy, Check, Link2Off, Rocket, Loader2, AlertCircle, Hammer, CheckCircle2 } from 'lucide-react';
import { useFetchMutation } from '@/hooks/use-fetch-mutation';
import { cn } from '@/lib/utils';

export interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  source: string;
  type: string;
  githubUrl: string | null;
  createdAt: string;
  deployments?: Array<{
    id: string;
    status: string;
    subdomain: string | null;
    containerPort: number | null;
    buildStep: string | null;
    createdAt: string;
  }>;
}

export interface ProjectTileProps {
  project: ProjectItem;
  onCopyUrl: (url: string) => void;
  copiedUrl: string | null;
  onDeploySuccess?: () => void;
}

export function ProjectTile({
  project,
  onCopyUrl,
  copiedUrl,
  onDeploySuccess,
}: ProjectTileProps): React.ReactElement {
  const { execute, loading, error, reset } = useFetchMutation();

  const framework =
    project.type === 'STATIC' || project.type === 'NODEJS' || project.type === 'NEXTJS' || project.type === 'DJANGO'
      ? project.type
      : 'STATIC';
  const latestDeployment = project.deployments?.[0];
  const status = latestDeployment?.status;
  const hasDeployed = status === 'DEPLOYED';
  const isInProgress = status === 'QUEUED' || status === 'BUILDING';
  const isFailed = status === 'FAILED';
  const url = getProjectUrl(project.slug, latestDeployment?.containerPort ?? undefined);
  const isCopied = copiedUrl === url;

  const handleDeploy = useCallback((): void => {
    reset();
    void execute({
      url: `/api/projects/${project.id}/deploy`,
      method: 'POST',
    }).then((result) => {
      if (result) onDeploySuccess?.();
    });
  }, [project.id, execute, reset, onDeploySuccess]);

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/projects/${project.id}`} className="min-w-0 flex-1 group">
            <CardTitle className="truncate text-base group-hover:underline">{project.name}</CardTitle>
            <CardDescription className="mt-0.5 truncate text-xs">/{project.slug}</CardDescription>
          </Link>
          <FrameworkLogo framework={framework} size={28} showLabel={false} className="shrink-0" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        {project.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
        )}
        {project.githubUrl && (
          <p className="truncate text-xs text-muted-foreground" title={project.githubUrl}>
            {project.githubUrl}
          </p>
        )}

        {!hasDeployed ? (
          <div className="mt-auto space-y-3">
            {isInProgress && (
              <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  <span>
                    {status === 'QUEUED' ? 'Queued – waiting for worker…' : 'Building – deploying your app…'}
                  </span>
                </div>
                {status === 'BUILDING' && latestDeployment?.buildStep && (
                  <BuildProgress currentStep={latestDeployment.buildStep} />
                )}
              </div>
            )}
            {isFailed && latestDeployment && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                <p className="font-medium">Deployment failed</p>
              </div>
            )}
            {!isInProgress && (
              <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Link2Off className="h-4 w-4 shrink-0" />
                <span>No link yet. Deploy to get your live URL.</span>
              </div>
            )}

            <Button
              variant="default"
              size="sm"
              className="w-full"
              onClick={handleDeploy}
              disabled={loading || isInProgress}
            >
              {loading || isInProgress ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Rocket className="mr-2 h-4 w-4" />
              )}
              {loading ? 'Deploying…' : isInProgress ? (status === 'QUEUED' ? 'Queued…' : 'Building…') : 'Deploy to get link'}
            </Button>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-auto space-y-2">
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1.5 text-xs">
              <span className="truncate text-muted-foreground" title={url}>
                {url}
              </span>
              <div className="ml-auto flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onCopyUrl(url)}
                  title="Copy URL"
                  aria-label="Copy project URL"
                >
                  {isCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open URL"
                    aria-label="Open project URL"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <FrameworkLogo framework={framework} size={16} showLabel />
              <Badge variant="secondary" className="text-xs font-normal">
                Deployed
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const BUILD_STEPS = [
  { key: 'CLONING', label: 'Cloning' },
  { key: 'BUILDING_IMAGE', label: 'Building' },
  { key: 'STARTING', label: 'Starting' },
] as const;

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
              <div className={cn('h-px w-3', isDone || isActive ? 'bg-yellow-500' : 'bg-muted-foreground/30')} />
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
