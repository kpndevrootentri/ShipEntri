/**
 * Project domain types (PRD-aligned).
 */

export type SourceType = 'GITHUB';

export type ProjectType = 'STATIC' | 'NODEJS' | 'NEXTJS' | 'DJANGO';

export interface CreateProjectDto {
  name: string;
  description?: string;
  source: 'GITHUB';
  githubUrl: string;
  type?: ProjectType;
  branch?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string | null;
  type?: ProjectType;
  branch?: string;
}

export interface ProjectWithLatestDeployment {
  id: string;
  name: string;
  slug: string;
  source: SourceType;
  githubUrl: string | null;
  type: ProjectType;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  deployments?: Array<{
    id: string;
    status: string;
    subdomain: string | null;
    createdAt: Date;
  }>;
}
