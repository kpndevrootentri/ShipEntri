import { deploymentRepository, type IDeploymentRepository } from '@/repositories/deployment.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { deploymentQueueAdapter, type IDeploymentQueue } from '@/lib/queue';
import { dockerService, type DockerService } from '@/services/docker';
import { gitService, type IGitService } from '@/services/git';
import { NotFoundError } from '@/lib/errors';
import type { Deployment } from '@prisma/client';

export class DeploymentService {
  constructor (
    private readonly deploymentRepo: IDeploymentRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly queue: IDeploymentQueue,
    private readonly docker: DockerService,
    private readonly git: IGitService
  ) { }

  /**
   * Creates a deployment record and enqueues build job.
   * If the queue (Redis) is unavailable, the deployment is still created; the job can be retried later.
   */
  async createDeployment(projectId: string, userId: string): Promise<Deployment> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new NotFoundError('Project');
    }
    if (project.userId !== userId) {
      throw new NotFoundError('Project');
    }
    const deployment = await this.deploymentRepo.create({ projectId, status: 'QUEUED' });
    try {
      await this.queue.add({
        deploymentId: deployment.id,
        projectId,
      });
    } catch (err) {
      const isConnectionError =
        (err as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
        (err as Error)?.message?.includes('ECONNREFUSED') ||
        err instanceof AggregateError;
      if (isConnectionError) {
        console.warn(
          '[DeploymentService] Queue unavailable (Redis not running?). Deployment created but not queued:',
          deployment.id
        );
      } else {
        throw err;
      }
    }
    return deployment;
  }

  /**
   * Fetches deployment by id; ensures user owns the project.
   */
  async getById(deploymentId: string, userId: string): Promise<Deployment> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.project.userId !== userId) {
      throw new NotFoundError('Deployment');
    }
    const { project: _p, ...deploymentOnly } = deployment;
    return deploymentOnly;
  }

  /**
   * Lists deployments for a project.
   */
  async listByProjectId(projectId: string, userId: string, limit = 10): Promise<Deployment[]> {
    const project = await this.projectRepo.findById(projectId);
    if (!project || project.userId !== userId) {
      throw new NotFoundError('Project');
    }
    return this.deploymentRepo.findByProjectId(projectId, limit);
  }

  /**
   * Process job: clone/pull repo, build image, run container. Called by worker.
   * Uses clone-once strategy: first deploy clones, subsequent deploys pull latest.
   */
  async buildAndDeploy(deploymentId: string): Promise<void> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      console.warn(
        '[DeploymentService] Deployment not found (stale or deleted job):',
        deploymentId
      );
      return;
    }
    const { project } = deployment;
    if (!project.githubUrl) {
      await this.deploymentRepo.update(deploymentId, { status: 'FAILED' });
      return;
    }

    const startedAt = new Date();

    try {
      await this.deploymentRepo.update(deploymentId, {
        status: 'BUILDING',
        buildStep: 'CLONING',
        startedAt,
      });

      const workDir = await this.git.ensureRepo(
        project.githubUrl,
        project.slug,
        project.branch,
      );

      await this.deploymentRepo.update(deploymentId, { buildStep: 'BUILDING_IMAGE' });
      const imageName = await this.docker.buildImage(project, workDir);

      await this.deploymentRepo.update(deploymentId, { buildStep: 'STARTING' });
      const containerPort = await this.docker.runContainer(
        imageName,
        project.type,
        `dropdeploy-${project.slug}`,
      );

      await this.deploymentRepo.clearSubdomainForOtherDeployments(
        project.id,
        project.slug,
        deploymentId
      );

      await this.deploymentRepo.update(deploymentId, {
        status: 'DEPLOYED',
        buildStep: null,
        containerPort,
        subdomain: project.slug,
        completedAt: new Date(),
      });
    } catch (err) {
      await this.deploymentRepo.update(deploymentId, {
        status: 'FAILED',
        buildStep: null,
        completedAt: new Date(),
      });
      throw err;
    }
  }
}

export const deploymentService = new DeploymentService(
  deploymentRepository,
  projectRepository,
  deploymentQueueAdapter,
  dockerService,
  gitService
);

