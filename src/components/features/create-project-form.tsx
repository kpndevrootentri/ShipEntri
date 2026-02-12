'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FRAMEWORK_CONFIG } from '@/components/ui/framework-logo';
import { cn } from '@/lib/utils';

type FrameworkType = 'STATIC' | 'NODEJS' | 'NEXTJS' | 'DJANGO';

const FRAMEWORK_KEYS: FrameworkType[] = ['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO'];

export interface CreateProjectFormProps {
  onSuccess?: () => void;
  className?: string;
  /** When true, renders only the form (no Card wrapper). Use inside a dialog. */
  embedded?: boolean;
}

export function CreateProjectForm({ onSuccess, className, embedded = false }: CreateProjectFormProps): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<FrameworkType>('STATIC');
  const [githubUrl, setGithubUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 3) {
      setError('Project name must be at least 3 characters');
      return;
    }
    if (!githubUrl.trim()) {
      setError('GitHub repository URL is required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          source: 'GITHUB',
          type,
          githubUrl: githubUrl.trim(),
          branch: branch.trim() || 'main',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to create project');
        setLoading(false);
        return;
      }
      setName('');
      setDescription('');
      setGithubUrl('');
      setBranch('main');
      onSuccess?.();
      setLoading(false);
    } catch {
      setError('Something went wrong');
      setLoading(false);
    }
  };

  const formContent = (
    <form onSubmit={handleSubmit} className={cn('space-y-4', embedded && 'pt-0')}>
      <div className="space-y-2">
        <Label htmlFor="project-name">Project name</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My awesome app"
          minLength={3}
          maxLength={50}
          required
        />
        <p className="text-xs text-muted-foreground">3–50 characters. Used to generate the project URL slug.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-description">Description (optional)</Label>
        <Textarea
          id="project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of the project"
          maxLength={500}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">{description.length}/500</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="github-url">GitHub repository URL</Label>
        <Input
          id="github-url"
          type="url"
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          placeholder="https://github.com/username/repo"
          required
        />
        <p className="text-xs text-muted-foreground">Public repository only. We clone and deploy from this URL.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="branch">Branch</Label>
        <Input
          id="branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          maxLength={100}
        />
        <p className="text-xs text-muted-foreground">The git branch to deploy. Defaults to <code className="bg-muted px-1 py-0.5 rounded text-xs">main</code>.</p>
      </div>

      <div className="space-y-2">
        <Label>Framework</Label>
        <p className="text-xs text-muted-foreground">Determines how the project is built and run.</p>
        <div className="grid grid-cols-4 gap-3" role="group" aria-label="Framework">
          {FRAMEWORK_KEYS.map((key) => {
            const config = FRAMEWORK_CONFIG[key];
            const { Logo, label, description } = config;
            const isSelected = type === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setType(key)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 text-center transition-colors',
                  'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-input bg-card'
                )}
                aria-pressed={isSelected}
                aria-label={`${label} – ${description}`}
              >
                <Logo size={40} className="shrink-0" />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create project'}
      </Button>
    </form>
  );

  if (embedded) {
    return <div className={cn(className)}>{formContent}</div>;
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Create project</CardTitle>
        <CardDescription>
          Add a new project from a GitHub repository. Provide a name and the repo URL.
        </CardDescription>
      </CardHeader>
      <CardContent>{formContent}</CardContent>
    </Card>
  );
}
