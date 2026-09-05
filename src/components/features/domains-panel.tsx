'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Plus,
  Trash2,
  Loader2,
  Check,
  Copy,
  Globe,
  RefreshCw,
  Star,
  ShieldCheck,
  AlertTriangle,
  Clock,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DomainStatus =
  | 'PENDING_DNS'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'FAILED';

interface DnsRecord {
  kind: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
  note?: string;
}

interface Domain {
  id: string;
  hostname: string;
  status: DomainStatus;
  isPrimary: boolean;
  redirectToPrimary: boolean;
  isApex: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  dnsRecords: DnsRecord[];
}

/** Statuses that are still moving — the panel polls while any domain is in one. */
const IN_FLIGHT: DomainStatus[] = ['PENDING_DNS', 'VERIFYING', 'VERIFIED', 'PROVISIONING'];

const STATUS_META: Record<
  DomainStatus,
  { label: string; hint: string; icon: React.ReactNode; className: string }
> = {
  PENDING_DNS: {
    label: 'Waiting for DNS',
    hint: 'Add the records below at your DNS provider. We re-check automatically.',
    icon: <Clock className="h-3.5 w-3.5" />,
    className: 'text-muted-foreground',
  },
  VERIFYING: {
    label: 'Checking',
    hint: 'Looking up your DNS records.',
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    className: 'text-muted-foreground',
  },
  VERIFIED: {
    label: 'Ownership confirmed',
    hint: 'Now point the domain at us so traffic can arrive.',
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    className: 'text-blue-600 dark:text-blue-400',
  },
  PROVISIONING: {
    label: 'Issuing certificate',
    hint: 'The first visit over HTTPS triggers the certificate. This usually takes under a minute.',
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    className: 'text-amber-600 dark:text-amber-400',
  },
  ACTIVE: {
    label: 'Live',
    hint: 'Serving over HTTPS.',
    icon: <Check className="h-3.5 w-3.5" />,
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  FAILED: {
    label: 'Needs attention',
    hint: 'Fix the problem below, then re-check.',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    className: 'text-destructive',
  },
};

// ---------------------------------------------------------------------------
// CopyField
// ---------------------------------------------------------------------------

function CopyField({ value }: { value: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable outside a secure context — the value is
      // still selectable on screen, so there is nothing to report.
    }
  };

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <code className="text-xs font-mono truncate flex-1 select-all">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={copy}
        title="Copy"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DnsRecordTable
// ---------------------------------------------------------------------------

function DnsRecordTable({ records }: { records: DnsRecord[] }): React.ReactElement {
  return (
    <div className="rounded-lg border divide-y">
      {records.map((record) => (
        <div key={`${record.kind}-${record.name}`} className="p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono shrink-0">
              {record.kind}
            </Badge>
            <CopyField value={record.name} />
          </div>
          <div className="pl-1">
            <CopyField value={record.value} />
          </div>
          {record.note && <p className="text-xs text-muted-foreground pt-0.5">{record.note}</p>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DomainRow
// ---------------------------------------------------------------------------

function DomainRow({
  domain,
  projectId,
  onChanged,
}: {
  domain: Domain;
  projectId: string;
  onChanged: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState<'verify' | 'primary' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRecords, setShowRecords] = useState(domain.status !== 'ACTIVE');

  const meta = STATUS_META[domain.status];

  const call = async (
    action: 'verify' | 'primary' | 'delete',
    request: () => Promise<Response>,
  ): Promise<void> => {
    setBusy(action);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? 'Something went wrong');
      } else {
        onChanged();
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const base = `/api/projects/${projectId}/domains/${domain.id}`;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            {domain.status === 'ACTIVE' ? (
              <a
                href={`https://${domain.hostname}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm font-mono font-medium hover:underline truncate"
              >
                {domain.hostname}
              </a>
            ) : (
              <code className="text-sm font-mono font-medium truncate">{domain.hostname}</code>
            )}
            {domain.isPrimary && (
              <Badge variant="outline" className="shrink-0 text-[10px] gap-1">
                <Star className="h-2.5 w-2.5" />
                Primary
              </Badge>
            )}
          </div>
          <div className={cn('flex items-center gap-1.5 text-xs', meta.className)}>
            {meta.icon}
            <span className="font-medium">{meta.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Re-check DNS now"
            disabled={busy !== null}
            onClick={() => call('verify', () => fetch(`${base}/verify`, { method: 'POST' }))}
          >
            {busy === 'verify' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>

          {domain.status === 'ACTIVE' && !domain.isPrimary && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Make this the primary domain"
              disabled={busy !== null}
              onClick={() =>
                call('primary', () =>
                  fetch(base, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isPrimary: true }),
                  }),
                )
              }
            >
              {busy === 'primary' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Star className="h-3.5 w-3.5" />
              )}
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            title="Remove domain"
            disabled={busy !== null}
            onClick={() => call('delete', () => fetch(base, { method: 'DELETE' }))}
          >
            {busy === 'delete' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* The service's message is the actionable one — it names the exact record
          that is missing or wrong. Fall back to the generic status hint. */}
      <p className="text-xs text-muted-foreground">{domain.lastError ?? meta.hint}</p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {domain.status !== 'ACTIVE' && (
        <>
          <button
            type="button"
            onClick={() => setShowRecords((v) => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showRecords ? 'Hide DNS records' : 'Show DNS records'}
          </button>
          {showRecords && <DnsRecordTable records={domain.dnsRecords} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddDomainForm
// ---------------------------------------------------------------------------

function AddDomainForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [hostname, setHostname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!hostname.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: hostname.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? 'Failed to add domain');
      } else {
        setHostname('');
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
        Add domain
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="domain-hostname" className="text-xs">
              Domain
            </Label>
            <Input
              id="domain-hostname"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="myapp.com"
              className="font-mono text-sm h-8"
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">
              A domain you already own. We&apos;ll show you the DNS records to add next.
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving || !hostname.trim()}>
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Adding…
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
                setHostname('');
                setError(null);
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
// DomainsPanel (exported)
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 15_000;

export function DomainsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDomains = useCallback(() => {
    setError(null);
    return fetch(`/api/projects/${projectId}/domains`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data.data) {
          setDomains(data.data);
        } else {
          setError(data?.error?.message ?? 'Failed to load domains');
        }
      })
      .catch(() => setError('Failed to load domains'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    void fetchDomains();
  }, [fetchDomains]);

  // Poll only while something is still settling. A DNS change can land minutes
  // after the user leaves this tab open, and the background worker is what
  // actually advances the state — this just picks the change up without a
  // manual refresh. Once every domain is terminal the timer is torn down.
  useEffect(() => {
    const settling = domains.some((d) => IN_FLIGHT.includes(d.status));
    if (!settling) {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
      return;
    }
    if (timer.current) return;
    timer.current = setInterval(() => void fetchDomains(), POLL_INTERVAL_MS);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [domains, fetchDomains]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Custom domains</CardTitle>
        <CardDescription>
          Serve this project from a domain you own. Add the DNS records we show you; the
          HTTPS certificate is issued and renewed automatically once ownership is confirmed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4">{error}</p>
        ) : domains.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Globe className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No custom domains yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              This project is reachable at its DropDeploy subdomain.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {domains.map((domain) => (
              <DomainRow
                key={domain.id}
                domain={domain}
                projectId={projectId}
                onChanged={fetchDomains}
              />
            ))}
          </div>
        )}

        <div className="pt-2">
          <AddDomainForm projectId={projectId} onCreated={fetchDomains} />
        </div>
      </CardContent>
    </Card>
  );
}
