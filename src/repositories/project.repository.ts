import type { Project, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CreateProjectDto, UpdateProjectDto } from '@/types/project.types';

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findByIdWithDeployments(id: string): Promise<Project | null>;
  findByUserId(userId: string): Promise<Project[]>;
  findBySlug(slug: string): Promise<Project | null>;
  create(userId: string, data: CreateProjectDto): Promise<Project>;
  update(id: string, data: UpdateProjectDto): Promise<Project>;
  delete(id: string): Promise<void>;
}

export class ProjectRepository implements IProjectRepository {
  async findById(id: string): Promise<Project | null> {
    return prisma.project.findUnique({ where: { id } });
  }

  async findByIdWithDeployments(id: string): Promise<Project | null> {
    return prisma.project.findUnique({
      where: { id },
      include: {
        deployments: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
  }

  async findByUserId(userId: string): Promise<Project[]> {
    return prisma.project.findMany({
      where: { userId },
      include: {
        deployments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  async findBySlug(slug: string): Promise<Project | null> {
    return prisma.project.findUnique({ where: { slug } });
  }

  async create(userId: string, data: CreateProjectDto): Promise<Project> {
    const slug = await this.generateUniqueSlug(data.name);
    return prisma.project.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        slug,
        source: data.source,
        githubUrl: data.githubUrl,
        type: data.type ?? 'STATIC',
        branch: data.branch ?? 'main',
      },
    });
  }

  async update(id: string, data: UpdateProjectDto): Promise<Project> {
    return prisma.project.update({
      where: { id },
      data: data as Prisma.ProjectUpdateInput,
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.project.delete({ where: { id } });
  }

  private async generateUniqueSlug(base: string): Promise<string> {
    const slugBase = base
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
    let slug = slugBase;
    let counter = 0;
    while (await this.findBySlug(slug)) {
      counter += 1;
      slug = `${slugBase}-${counter}`;
    }
    return slug;
  }
}

export const projectRepository = new ProjectRepository();
