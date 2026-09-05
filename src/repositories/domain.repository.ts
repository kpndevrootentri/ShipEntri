import type { CustomDomain, DomainStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** The minimum a request needs to route a custom host to a container. */
export interface DomainRoute {
  hostname: string;
  /** Project slug — equals `Deployment.subdomain`, the proxy's routing key. */
  slug: string;
  status: DomainStatus;
  isPrimary: boolean;
  redirectToPrimary: boolean;
  /** Hostname of this project's primary domain, when one is ACTIVE. */
  primaryHostname: string | null;
}

export interface IDomainRepository {
  findById(id: string): Promise<CustomDomain | null>;
  findByHostname(hostname: string): Promise<CustomDomain | null>;
  listByProject(projectId: string): Promise<CustomDomain[]>;
  /** Every domain belonging to any project owned by `userId` — for quota. */
  countByUser(userId: string): Promise<number>;
  create(data: { hostname: string; projectId: string; verificationToken: string }): Promise<CustomDomain>;
  update(id: string, data: Prisma.CustomDomainUpdateInput): Promise<CustomDomain>;
  delete(id: string): Promise<void>;
  /** Clears `isPrimary` on the project's other domains, then sets it on `id`. */
  setPrimary(projectId: string, id: string): Promise<CustomDomain>;
  /**
   * Routing lookup for the proxy hot path. Returns null for unknown hosts so
   * the caller can negative-cache them.
   */
  findRoute(hostname: string): Promise<DomainRoute | null>;
  /**
   * Domains due for a background DNS re-check: anything not yet terminal,
   * oldest check first.
   */
  findDueForRecheck(olderThan: Date, limit: number): Promise<CustomDomain[]>;
}

/** Statuses the ask endpoint and the router treat as "the owner proved it". */
export const ISSUABLE_STATUSES: DomainStatus[] = ['VERIFIED', 'PROVISIONING', 'ACTIVE'];

/** Statuses a background re-check should keep polling. */
const RECHECKABLE_STATUSES: DomainStatus[] = ['PENDING_DNS', 'VERIFYING', 'VERIFIED', 'PROVISIONING', 'FAILED'];

export class DomainRepository implements IDomainRepository {
  async findById(id: string): Promise<CustomDomain | null> {
    return prisma.customDomain.findUnique({ where: { id } });
  }

  async findByHostname(hostname: string): Promise<CustomDomain | null> {
    return prisma.customDomain.findUnique({ where: { hostname } });
  }

  async listByProject(projectId: string): Promise<CustomDomain[]> {
    return prisma.customDomain.findMany({
      where: { projectId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async countByUser(userId: string): Promise<number> {
    return prisma.customDomain.count({ where: { project: { userId } } });
  }

  async create(data: { hostname: string; projectId: string; verificationToken: string }): Promise<CustomDomain> {
    return prisma.customDomain.create({ data });
  }

  async update(id: string, data: Prisma.CustomDomainUpdateInput): Promise<CustomDomain> {
    return prisma.customDomain.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await prisma.customDomain.delete({ where: { id } });
  }

  async setPrimary(projectId: string, id: string): Promise<CustomDomain> {
    // One transaction so the project is never left with zero or two primaries.
    const [, updated] = await prisma.$transaction([
      prisma.customDomain.updateMany({
        where: { projectId, NOT: { id } },
        data: { isPrimary: false },
      }),
      prisma.customDomain.update({ where: { id }, data: { isPrimary: true } }),
    ]);
    return updated;
  }

  async findRoute(hostname: string): Promise<DomainRoute | null> {
    const row = await prisma.customDomain.findUnique({
      where: { hostname },
      select: {
        hostname: true,
        status: true,
        isPrimary: true,
        redirectToPrimary: true,
        project: {
          select: {
            slug: true,
            customDomains: {
              where: { isPrimary: true, status: 'ACTIVE' },
              select: { hostname: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!row) return null;
    return {
      hostname: row.hostname,
      slug: row.project.slug,
      status: row.status,
      isPrimary: row.isPrimary,
      redirectToPrimary: row.redirectToPrimary,
      primaryHostname: row.project.customDomains[0]?.hostname ?? null,
    };
  }

  async findDueForRecheck(olderThan: Date, limit: number): Promise<CustomDomain[]> {
    return prisma.customDomain.findMany({
      where: {
        status: { in: RECHECKABLE_STATUSES },
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: olderThan } }],
      },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: limit,
    });
  }
}

export const domainRepository = new DomainRepository();
