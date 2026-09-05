import type { User, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  create(data: { email: string; passwordHash: string; role?: UserRole; mustResetPassword?: boolean }): Promise<User>;
  updateRole(id: string, role: UserRole): Promise<User>;
  updateQuota(id: string, quota: number): Promise<User>;
  /** Custom domains the user may claim across all their projects. */
  updateDomainQuota(id: string, quota: number): Promise<User>;
  setPassword(id: string, passwordHash: string): Promise<User>;
  delete(id: string): Promise<void>;
}

export class UserRepository implements IUserRepository {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findAll(): Promise<User[]> {
    return prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async create(data: { email: string; passwordHash: string; role?: UserRole; mustResetPassword?: boolean }): Promise<User> {
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        ...(data.role ? { role: data.role } : {}),
        ...(data.mustResetPassword !== undefined ? { mustResetPassword: data.mustResetPassword } : {}),
      },
    });
  }

  async updateRole(id: string, role: UserRole): Promise<User> {
    return prisma.user.update({ where: { id }, data: { role } });
  }

  async updateQuota(id: string, quota: number): Promise<User> {
    return prisma.user.update({ where: { id }, data: { projectQuota: quota } });
  }

  async updateDomainQuota(id: string, quota: number): Promise<User> {
    return prisma.user.update({ where: { id }, data: { domainQuota: quota } });
  }

  async setPassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { passwordHash, mustResetPassword: false },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.user.delete({ where: { id } });
  }
}

export const userRepository = new UserRepository();
