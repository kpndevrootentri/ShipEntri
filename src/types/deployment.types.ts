/**
 * Deployment domain types (PRD-aligned).
 */

export type DeploymentStatus = 'QUEUED' | 'BUILDING' | 'DEPLOYED' | 'FAILED';

export interface DeploymentJob {
  deploymentId: string;
  projectId: string;
}

export interface CreateDeploymentDto {
  projectId: string;
}

export interface DeploymentWithProject {
  id: string;
  status: DeploymentStatus;
  containerPort: number | null;
  subdomain: string | null;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
  project: {
    id: string;
    name: string;
    slug: string;
    type: string;
  };
}
