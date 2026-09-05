import type { DomainRoute } from '@/repositories/domain.repository';
import { normalizeHostKey } from '@/lib/host-key';
import { PROMOTABLE_STATUSES } from '@/lib/domain-status';

/**
 * Host → project-slug resolution for the proxy hot path.
 *
 * Every request to a custom domain passes through here, so the design goal is
 * "almost never touch Postgres":
 *
 *   L1  in-process Map, 60s positive / 30s negative TTL, size-capped
 *   L2  Redis, 300s TTL, shared by every app instance
 *   L3  Postgres
 *
 * Unknown hosts are negative-cached too. Without that, anyone pointing a
 * hostname at the platform IP — or just scanning it — would turn each request
 * into a database round trip.
 *
 * Invalidation deletes the L2 key and this process's L1 entry. Other instances
 * keep a stale L1 entry for at most `L1_TTL_MS`; that bound is the reason the
 * L1 TTL is deliberately short. It is an acceptable window because the worst
 * case is a domain serving its old target, or 404ing, for up to a minute after
 * a change — never a privacy or authorisation decision, which the proxy route
 * re-evaluates from the database on every request regardless.
 *
 * `prisma` and `ioredis` are imported lazily so that a request which never
 * touches a custom domain never *executes* their module initialisation — the
 * connection setup, not the download. Next bundles middleware as a single unit
 * and statically analyses literal dynamic imports, so this defers execution,
 * not bundle size; do not read it as a size optimisation.
 */

const L1_TTL_MS = 60_000;
const L1_NEGATIVE_TTL_MS = 30_000;
const L1_MAX_ENTRIES = 5_000;

const L2_TTL_S = 300;
const L2_PREFIX = 'domain-route:';

interface L1Entry {
  route: DomainRoute | null;
  expiresAt: number;
}

const l1 = new Map<string, L1Entry>();

function l1Get(host: string): L1Entry | undefined {
  const entry = l1.get(host);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    l1.delete(host);
    return undefined;
  }
  // Refresh insertion order so the eviction below is roughly LRU.
  l1.delete(host);
  l1.set(host, entry);
  return entry;
}

function l1Set(host: string, route: DomainRoute | null): void {
  if (l1.size >= L1_MAX_ENTRIES) {
    // Map preserves insertion order — the first key is the least recently used.
    const oldest = l1.keys().next().value;
    if (oldest !== undefined) l1.delete(oldest);
  }
  l1.set(host, {
    route,
    expiresAt: Date.now() + (route ? L1_TTL_MS : L1_NEGATIVE_TTL_MS),
  });
}

/** Redis is best-effort: a cache outage must degrade to Postgres, not to 500s. */
async function l2Get(host: string): Promise<{ route: DomainRoute | null } | null> {
  try {
    const { getRedisConnection } = await import('@/lib/redis');
    const raw = await getRedisConnection().get(L2_PREFIX + host);
    if (raw === null) return null;
    return { route: JSON.parse(raw) as DomainRoute | null };
  } catch {
    return null;
  }
}

async function l2Set(host: string, route: DomainRoute | null): Promise<void> {
  try {
    const { getRedisConnection } = await import('@/lib/redis');
    await getRedisConnection().set(L2_PREFIX + host, JSON.stringify(route), 'EX', L2_TTL_S);
  } catch {
    // Cache write failure is not a request failure.
  }
}

/**
 * Resolves a `Host` header to a routing decision, or null if the hostname is
 * not a known custom domain.
 */
export async function resolveHostRoute(hostname: string): Promise<DomainRoute | null> {
  const host = normalizeHostKey(hostname);
  if (!host) return null;

  const cached = l1Get(host);
  if (cached) return cached.route;

  const fromL2 = await l2Get(host);
  if (fromL2) {
    l1Set(host, fromL2.route);
    return fromL2.route;
  }

  const { domainRepository } = await import('@/repositories/domain.repository');
  const route = await domainRepository.findRoute(host);

  l1Set(host, route);
  await l2Set(host, route);
  return route;
}

/**
 * Drops a hostname from both cache tiers. Call after any mutation that changes
 * how a host routes: add, verify, status change, primary swap, delete.
 */
export async function invalidateHost(...hostnames: string[]): Promise<void> {
  const hosts = hostnames.map(normalizeHostKey).filter(Boolean);
  if (hosts.length === 0) return;

  for (const host of hosts) l1.delete(host);

  try {
    const { getRedisConnection } = await import('@/lib/redis');
    await getRedisConnection().del(...hosts.map((h) => L2_PREFIX + h));
  } catch {
    // L2 miss just falls through to Postgres on the next request.
  }
}

/**
 * Promotes a host to ACTIVE after the edge has actually served TLS for it.
 *
 * The "ask" endpoint fires *before* issuance, so a 200 there only means we
 * permitted an order — it is not evidence a certificate exists. A real HTTPS
 * request arriving for the host is. The proxy calls this fire-and-forget on
 * such a request; the cache entry it then evicts means the write happens at
 * most once per cache TTL per instance, not once per request.
 *
 * Implemented here against Prisma directly rather than through DomainService so
 * that the proxy path never initialises the service's config, Zod and DNS
 * dependencies.
 */
export async function promoteHostToActive(hostname: string): Promise<void> {
  const host = normalizeHostKey(hostname);
  try {
    const { prisma } = await import('@/lib/prisma');
    const { count } = await prisma.customDomain.updateMany({
      where: { hostname: host, status: { in: PROMOTABLE_STATUSES } },
      data: { status: 'ACTIVE', certIssuedAt: new Date(), lastError: null, failureCount: 0 },
    });
    if (count > 0) await invalidateHost(host);
  } catch {
    // Best-effort: the background re-check will settle the status anyway.
  }
}

/** Test seam — clears the in-process tier only. */
export function __clearL1(): void {
  l1.clear();
}
