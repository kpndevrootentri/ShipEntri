import type { ProjectAccess } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** A USER access entry joined with the granted user's identity for display. */
export interface ProjectAccessEntry {
  id: string;
  kind: 'USER' | 'DOMAIN';
  userId: string | null;
  domain: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface IProjectAccessRepository {
  listByProject(projectId: string): Promise<ProjectAccessEntry[]>;
  findById(id: string): Promise<ProjectAccess | null>;
  addUser(projectId: string, userId: string): Promise<ProjectAccess>;
  addDomain(projectId: string, domain: string): Promise<ProjectAccess>;
  delete(id: string): Promise<void>;
  /**
   * True if the given user (by id) or email domain is explicitly granted access
   * to the project. The owner check is handled separately by the caller.
   */
  isAuthorized(projectId: string, userId: string, email: string): Promise<boolean>;
}

export class ProjectAccessRepository implements IProjectAccessRepository {
  async listByProject(projectId: string): Promise<ProjectAccessEntry[]> {
    const rows = await prisma.projectAccess.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      userId: r.userId,
      domain: r.domain,
      email: r.user?.email ?? null,
      avatarUrl: null,
      createdAt: r.createdAt,
    }));
  }

  async findById(id: string): Promise<ProjectAccess | null> {
    return prisma.projectAccess.findUnique({ where: { id } });
  }

  async addUser(projectId: string, userId: string): Promise<ProjectAccess> {
    return prisma.projectAccess.create({
      data: { projectId, kind: 'USER', userId },
    });
  }

  async addDomain(projectId: string, domain: string): Promise<ProjectAccess> {
    return prisma.projectAccess.create({
      data: { projectId, kind: 'DOMAIN', domain },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.projectAccess.delete({ where: { id } });
  }

  async isAuthorized(projectId: string, userId: string, email: string): Promise<boolean> {
    const domain = email.includes('@') ? email.split('@').pop()!.toLowerCase() : null;
    const match = await prisma.projectAccess.findFirst({
      where: {
        projectId,
        OR: [
          { kind: 'USER', userId },
          ...(domain ? [{ kind: 'DOMAIN' as const, domain }] : []),
        ],
      },
      select: { id: true },
    });
    return match !== null;
  }
}

export const projectAccessRepository = new ProjectAccessRepository();
