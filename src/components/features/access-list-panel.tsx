'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Plus, Trash2, Loader2, Check, Users, AtSign, Globe } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccessEntry {
  id: string;
  kind: 'USER' | 'DOMAIN';
  userId: string | null;
  domain: string | null;
  email: string | null;
  createdAt: string;
}

type GrantMode = 'email' | 'domain';

// ---------------------------------------------------------------------------
// AccessRow
// ---------------------------------------------------------------------------

function AccessRow({
  entry,
  projectId,
  onDeleted,
}: {
  entry: AccessEntry;
  projectId: string;
  onDeleted: () => void;
}): React.ReactElement {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/access/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.message ?? 'Failed to remove');
      } else {
        onDeleted();
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setDeleting(false);
    }
  };

  const isDomain = entry.kind === 'DOMAIN';
  const label = isDomain ? `@${entry.domain}` : (entry.email ?? 'Unknown user');

  return (
    <div className="group border rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isDomain ? (
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <AtSign className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <code className="text-sm font-mono font-medium truncate">{label}</code>
          <Badge variant="outline" className="shrink-0 text-xs">
            {isDomain ? 'Domain' : 'User'}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
          onClick={handleDelete}
          disabled={deleting}
          title="Remove access"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddAccessForm
// ---------------------------------------------------------------------------

function AddAccessForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GrantMode>('email');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setValue('');
    setError(null);
    setMode('email');
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!value.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const body = mode === 'email' ? { email: value.trim() } : { domain: value.trim() };
      const res = await fetch(`/api/projects/${projectId}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.message ?? 'Failed to add');
      } else {
        reset();
        setOpen(false);
        onCreated();
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Grant access
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Grant by</Label>
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as GrantMode);
                setValue('');
                setError(null);
              }}
              className={cn(
                'flex h-8 w-full max-w-[220px] rounded-md border border-input bg-background px-3 text-sm',
                'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              <option value="email">Specific user (email)</option>
              <option value="domain">Whole email domain</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="access-value" className="text-xs">
              {mode === 'email' ? 'User email' : 'Email domain'}
            </Label>
            <Input
              id="access-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === 'email' ? 'teammate@entri.me' : 'entri.me'}
              className="font-mono text-sm h-8"
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">
              {mode === 'email'
                ? 'The user must already have a DropDeploy account.'
                : 'Anyone signed in with an email at this domain can view the private URL.'}
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving || !value.trim()}>
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Add
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AccessListPanel (exported)
// ---------------------------------------------------------------------------

export function AccessListPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    setError(null);
    fetch(`/api/projects/${projectId}/access`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data.data) {
          setEntries(data.data);
        } else {
          setError(data?.error?.message ?? 'Failed to load');
        }
      })
      .catch(() => setError('Failed to load access list'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Who can access this private URL</CardTitle>
        <CardDescription>
          The owner always has access. Grant additional people by email, or open it up to a whole
          email domain. Everyone else sees an access-denied page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4">{error}</p>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Users className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Only you can access this URL</p>
            <p className="text-xs text-muted-foreground mt-1">
              Grant a teammate or a domain to share it.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <AccessRow key={entry.id} entry={entry} projectId={projectId} onDeleted={fetchEntries} />
            ))}
          </div>
        )}

        <div className="pt-2">
          <AddAccessForm projectId={projectId} onCreated={fetchEntries} />
        </div>
      </CardContent>
    </Card>
  );
}
