import { Registry, Gauge, collectDefaultMetrics } from 'prom-client';
import { prisma } from './prisma';
import { getRedisConnection } from './redis';

const HEARTBEAT_KEY = 'worker:health';
const HEARTBEAT_TTL_S = 90;

// Singleton registry — guards against duplicate registration during Next.js hot reload.
const g = globalThis as typeof globalThis & { _metricsRegistry?: Registry };

if (!g._metricsRegistry) {
  const register = new Registry();

  collectDefaultMetrics({ register, prefix: 'dropdeploy_node_' });

  // ── Worker liveness ──────────────────────────────────────────────────────────
  new Gauge({
    name: 'dropdeploy_worker_alive',
    help: '1 if BullMQ worker heartbeat is fresh (<90s), 0 if stale or absent',
    registers: [register],
    async collect() {
      try {
        const raw = await getRedisConnection().get(HEARTBEAT_KEY);
        if (!raw) { this.set(0); return; }
        const { timestamp } = JSON.parse(raw) as { timestamp: string };
        const ageSeconds = (Date.now() - new Date(timestamp).getTime()) / 1000;
        this.set(ageSeconds < HEARTBEAT_TTL_S ? 1 : 0);
      } catch {
        this.set(0);
      }
    },
  });

  // ── Queue depth ──────────────────────────────────────────────────────────────
  new Gauge({
    name: 'dropdeploy_queue_depth',
    help: 'Number of deployments currently waiting in QUEUED state',
    registers: [register],
    async collect() {
      try {
        const count = await prisma.deployment.count({ where: { status: 'QUEUED' } });
        this.set(count);
      } catch {
        this.set(0);
      }
    },
  });

  // ── Deployment totals by status + project type ───────────────────────────────
  new Gauge({
    name: 'dropdeploy_deployments_total',
    help: 'Total deployment count grouped by status and project type',
    labelNames: ['status', 'project_type'] as const,
    registers: [register],
    async collect() {
      try {
        const rows = await prisma.$queryRaw<{ status: string; type: string; count: bigint }[]>`
          SELECT d.status, p.type, COUNT(*) AS count
          FROM deployments d
          JOIN projects p ON d.project_id = p.id
          GROUP BY d.status, p.type
        `;
        this.reset();
        for (const row of rows) {
          this.labels(row.status, row.type).set(Number(row.count));
        }
      } catch {
        // Leave as last known value on transient DB errors
      }
    },
  });

  // ── Build duration percentiles (last 200 successful deployments) ─────────────
  new Gauge({
    name: 'dropdeploy_build_duration_p50_seconds',
    help: 'P50 (median) build duration in seconds across the last 200 successful deployments',
    registers: [register],
    async collect() {
      try { this.set(await buildDurationPercentile(0.5)); } catch { /* retain last */ }
    },
  });

  new Gauge({
    name: 'dropdeploy_build_duration_p95_seconds',
    help: 'P95 build duration in seconds across the last 200 successful deployments',
    registers: [register],
    async collect() {
      try { this.set(await buildDurationPercentile(0.95)); } catch { /* retain last */ }
    },
  });

  // ── Active deployed projects ─────────────────────────────────────────────────
  new Gauge({
    name: 'dropdeploy_active_projects_total',
    help: 'Number of projects that have at least one DEPLOYED deployment',
    registers: [register],
    async collect() {
      try {
        const count = await prisma.deployment.groupBy({
          by: ['projectId'],
          where: { status: 'DEPLOYED' },
          _count: true,
        });
        this.set(count.length);
      } catch {
        this.set(0);
      }
    },
  });

  // ── Proxy traffic ────────────────────────────────────────────────────────────
  new Gauge({
    name: 'dropdeploy_proxy_hits_total',
    help: 'Total proxy hits in the last 24 hours',
    registers: [register],
    async collect() {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const count = await prisma.proxyHit.count({ where: { createdAt: { gte: since } } });
        this.set(count);
      } catch {
        this.set(0);
      }
    },
  });

  g._metricsRegistry = register;
}

export const register = g._metricsRegistry!;

// Shared row cache: both p50 and p95 gauges call buildDurationPercentile on
// every scrape. Without caching they'd run two identical 200-row DB queries.
// 30s TTL is well under the 10s scrape interval's concern since both gauges
// collect() within the same register.metrics() call.
let _durationCache: {
  rows: Array<{ startedAt: Date | null; completedAt: Date | null }>;
  at: number;
} | null = null;

async function getDurationRows() {
  const now = Date.now();
  if (!_durationCache || now - _durationCache.at > 30_000) {
    _durationCache = {
      rows: await prisma.deployment.findMany({
        where: {
          status: 'DEPLOYED',
          startedAt: { not: null },
          completedAt: { not: null },
        },
        select: { startedAt: true, completedAt: true },
        orderBy: { completedAt: 'desc' },
        take: 200,
      }),
      at: now,
    };
  }
  return _durationCache.rows;
}

async function buildDurationPercentile(p: number): Promise<number> {
  const rows = await getDurationRows();
  if (rows.length === 0) return 0;
  const durations = rows
    .map((d) => (d.completedAt!.getTime() - d.startedAt!.getTime()) / 1000)
    .sort((a, b) => a - b);
  return durations[Math.floor(p * (durations.length - 1))] ?? 0;
}
