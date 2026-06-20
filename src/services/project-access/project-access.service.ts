import {
  projectAccessRepository,
  type IProjectAccessRepository,
  type ProjectAccessEntry,
} from '@/repositories/project-access.repository';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { NotFoundError, ConflictError, ValidationError } from '@/lib/errors';
import type { GrantAccessDto } from '@/validators/project-access.validator';

/** Minimal project shape needed to make an access decision. */
export interface AccessProject {
  id: string;
  userId: string;
}

/** Minimal session shape needed to make an access decision. */
export interface AccessSession {
  userId: string;
  email: string;
  role: string;
}

export class ProjectAccessService {
  constructor(
    private readonly accessRepo: IProjectAccessRepository,
    private readonly userRepo: IUserRepository,
    private readonly projectRepo: IProjectRepository,
  ) {}

  /** Lists access entries for a project the caller owns. */
  async list(projectId: string, ownerId: string): Promise<ProjectAccessEntry[]> {
    await this.assertOwner(projectId, ownerId);
    return this.accessRepo.listByProject(projectId);
  }

  /** Grants access to a specific user (by email) or a whole email domain. */
  async grant(projectId: string, ownerId: string, dto: GrantAccessDto): Promise<ProjectAccessEntry> {
    const project = await this.assertOwner(projectId, ownerId);

    try {
      if (dto.email) {
        const user = await this.userRepo.findByEmail(dto.email);
        if (!user) {
          throw new NotFoundError('User with that email');
        }
        if (user.id === project.userId) {
          throw new ConflictError('The owner already has access');
        }
        await this.accessRepo.addUser(projectId, user.id);
      } else if (dto.domain) {
        await this.accessRepo.addDomain(projectId, dto.domain);
      } else {
        throw new ValidationError('Provide an email or a domain');
      }
    } catch (err) {
      // Prisma unique-constraint violation → already granted
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new ConflictError('That user or domain already has access');
      }
      throw err;
    }

    // Return the freshly created entry (last by createdAt)
    const entries = await this.accessRepo.listByProject(projectId);
    return entries[entries.length - 1];
  }

  /** Revokes an access entry. Verifies the entry belongs to a project the caller owns. */
  async revoke(projectId: string, ownerId: string, accessId: string): Promise<void> {
    await this.assertOwner(projectId, ownerId);
    const entry = await this.accessRepo.findById(accessId);
    if (!entry || entry.projectId !== projectId) {
      throw new NotFoundError('Access entry');
    }
    await this.accessRepo.delete(accessId);
  }

  /**
   * Central authorization rule for serving a private deployment.
   * Allows the owner, anyone on the access list (USER or DOMAIN), and platform
   * admins (CONTRIBUTOR). Remove the role clause for strict owner/list-only access.
   */
  async canView(project: AccessProject, session: AccessSession): Promise<boolean> {
    if (session.userId === project.userId) return true;
    if (session.role === 'CONTRIBUTOR') return true;
    return this.accessRepo.isAuthorized(project.id, session.userId, session.email);
  }

  private async assertOwner(projectId: string, ownerId: string): Promise<{ id: string; userId: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project || project.userId !== ownerId) {
      throw new NotFoundError('Project');
    }
    return { id: project.id, userId: project.userId };
  }
}

export const projectAccessService = new ProjectAccessService(
  projectAccessRepository,
  userRepository,
  projectRepository,
);
