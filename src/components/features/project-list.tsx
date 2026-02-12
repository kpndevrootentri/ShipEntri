'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ProjectTile, type ProjectItem } from '@/components/features/project-tile';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 2500;

export type { ProjectItem };

export function ProjectList({
  onRefresh,
  className,
}: {
  onRefresh?: number;
  className?: string;
}): React.ReactElement {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProjects = useCallback((): void => {
    setLoading(true);
    fetch('/api/projects')
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.data)) {
          setProjects(data.data);
        }
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  const hasInProgressDeployment = useCallback((list: ProjectItem[]): boolean => {
    return list.some((p) => {
      const status = p.deployments?.[0]?.status;
      return status === 'QUEUED' || status === 'BUILDING';
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/projects')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.success && Array.isArray(data.data)) {
          setProjects(data.data);
        }
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onRefresh]);

  useEffect(() => {
    if (!hasInProgressDeployment(projects)) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      fetch('/api/projects')
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && Array.isArray(data.data)) {
            setProjects(data.data);
          }
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [projects, hasInProgressDeployment, fetchProjects]);

  const handleCopyUrl = (url: string): void => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    });
  };

  if (loading) {
    return (
      <Card className={cn(className)}>
        <CardHeader>
          <CardTitle>Your projects</CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (projects.length === 0) {
    return (
      <Card className={cn(className)}>
        <CardHeader>
          <CardTitle>Your projects</CardTitle>
          <CardDescription>No projects yet. Create one above to get started.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <h3 className="text-lg font-semibold">Your projects</h3>
        <p className="text-sm text-muted-foreground">
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectTile
            key={project.id}
            project={project}
            onCopyUrl={handleCopyUrl}
            copiedUrl={copiedUrl}
            onDeploySuccess={fetchProjects}
          />
        ))}
      </div>
    </div>
  );
}
