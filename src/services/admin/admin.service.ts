import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import type { User, UserRole, Project } from '@prisma/client';
import type { IUserRepository } from '@/repositories/user.repository';
import { userRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import { projectRepository } from '@/repositories/project.repository';
import { dockerService, type DockerService } from '@/services/docker';
import { deploymentService } from '@/services/deployment';
import { getConfig } from '@/lib/config';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/errors';

const SALT_ROUNDS = 10;

export class AdminService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly docker: DockerService,
  ) {}

  async listAllUsers(): Promise<(User & { _count: { projects: number } })[]> {
    const users = await this.userRepo.findAll();
    // Attach project counts via a separate query approach using prisma directly
    // We use the repo's findAll and augment with project count
    const { prisma } = await import('@/lib/prisma');
    return prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { projects: true } } },
    }) as Promise<(User & { _count: { projects: number } })[]>;
  }

  async changeUserRole(userId: string, role: UserRole, actorId: string): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');

    // If demoting a contributor, ensure at least one other contributor remains
    if (role !== 'CONTRIBUTOR' && user.role === 'CONTRIBUTOR') {
      const { prisma } = await import('@/lib/prisma');
      const contributorCount = await prisma.user.count({ where: { role: 'CONTRIBUTOR' } });
      if (contributorCount <= 1) {
        throw new ConflictError('Cannot remove the last CONTRIBUTOR');
      }
    }

    return this.userRepo.updateRole(userId, role);
  }

  async deleteUser(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new ValidationError('Cannot delete your own account');
    }
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');

    if (user.role === 'CONTRIBUTOR') {
      const { prisma } = await import('@/lib/prisma');
      const contributorCount = await prisma.user.count({ where: { role: 'CONTRIBUTOR' } });
      if (contributorCount <= 1) {
        throw new ConflictError('Cannot delete the last CONTRIBUTOR');
      }
    }

    await this.userRepo.delete(userId);
  }

  async createUser(email: string, password: string): Promise<User> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) throw new ConflictError('Email already registered');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    return this.userRepo.create({ email, passwordHash, role: 'USER', mustResetPassword: true });
  }

  async listAllProjects(): Promise<(Project & { user: { id: string; email: string; role: string }; deployments: { id: string; status: string; createdAt: Date }[] })[]> {
    return this.projectRepo.findAll();
  }

  async transferOwnership(projectId: string, newOwnerId: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    const newOwner = await this.userRepo.findById(newOwnerId);
    if (!newOwner) throw new NotFoundError('User');
    return this.projectRepo.transferOwner(projectId, newOwnerId);
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.stopAndRemoveContainer(`dropdeploy-${project.slug}`);
    const { STATIC_SERVE_DIR } = getConfig();
    await fs.promises.rm(path.join(STATIC_SERVE_DIR, project.slug), { recursive: true, force: true }).catch(() => {});
    await this.projectRepo.delete(projectId);
  }

  async getProjectContainerInfo(projectId: string): Promise<ReturnType<DockerService['getContainerInfo']>> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    return this.docker.getContainerInfo(`dropdeploy-${project.slug}`);
  }

  async stopContainer(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.stopContainer(`dropdeploy-${project.slug}`);
  }

  async restartContainer(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.restartContainer(`dropdeploy-${project.slug}`);
  }

  async updateUserQuota(userId: string, quota: number): Promise<User> {
    if (quota < 0) throw new ValidationError('Quota must be a non-negative integer');
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    return this.userRepo.updateQuota(userId, quota);
  }

  /** Custom-domain allowance. Zero means the user cannot add any. */
  async updateUserDomainQuota(userId: string, quota: number): Promise<User> {
    if (quota < 0) throw new ValidationError('Quota must be a non-negative integer');
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    return this.userRepo.updateDomainQuota(userId, quota);
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    if (newPassword.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.userRepo.setPassword(userId, passwordHash);
  }

  async forceRedeploy(projectId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    // Bypass ownership check by delegating to deploymentService with the project's actual owner
    await deploymentService.createDeployment(projectId, project.userId);
  }
}

export const adminService = new AdminService(userRepository, projectRepository, dockerService);
