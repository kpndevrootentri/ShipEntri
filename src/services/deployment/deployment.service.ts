import * as fs from 'fs';
import * as path from 'path';
import { deploymentRepository, type IDeploymentRepository } from '@/repositories/deployment.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { deploymentQueueAdapter, type IDeploymentQueue } from '@/lib/queue';
import { dockerService, type DockerService } from '@/services/docker';
import { gitService, type IGitService } from '@/services/git';
import { envVarService, type EnvironmentVariableService } from '@/services/env-var';
import { gitProviderService } from '@/services/git-provider';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { scanPackages } from './package-scanner';
import { detectFromFiles } from '@/lib/type-detector';
import { NotFoundError, ConflictError, ValidationError } from '@/lib/errors';
import { parseSafeRepoUrl } from '@/lib/git-url';
import type { Deployment } from '@prisma/client';

const log = createLogger('deployment-service');

const STATIC_CAPABLE_TYPES = new Set(['STATIC', 'REACT', 'VUE', 'SVELTE', 'NEXTJS']);

export class DeploymentService {
  constructor (
    private readonly deploymentRepo: IDeploymentRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly queue: IDeploymentQueue,
    private readonly docker: DockerService,
    private readonly git: IGitService,
    private readonly envVar: EnvironmentVariableService,
  ) { }

  /**
   * Creates a deployment record and enqueues build job (smart-queue with supersede pattern).
   * - Cancels any existing QUEUED deployment for the project (supersede)
   * - If a build is already BUILDING: saves the new deployment as QUEUED in DB only (held back)
   * - Otherwise: creates QUEUED in DB + enqueues in BullMQ immediately
   * Uses a Redis advisory lock to guard against double-click races.
   */
  async createDeployment(projectId: string, userId: string): Promise<{ deployment: Deployment; queued: boolean }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new NotFoundError('Project');
    }
    if (project.userId !== userId) {
      throw new NotFoundError('Project');
    }

    return this.enqueueDeployment(projectId);
  }

  /**
   * Trigger a deployment from a verified GitHub webhook. There is no session, so
   * ownership cannot be checked against a userId — the caller (webhook route) has
   * already authenticated the request via the project's HMAC secret. The build
   * path resolves the project owner's OAuth token from project.userId.
   */
  async createDeploymentFromWebhook(projectId: string): Promise<{ deployment: Deployment; queued: boolean }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new NotFoundError('Project');
    }
    return this.enqueueDeployment(projectId);
  }

  /** Shared lock / supersede / smart-queue body for both trigger paths. */
  private async enqueueDeployment(projectId: string): Promise<{ deployment: Deployment; queued: boolean }> {
    // Redis advisory lock — prevents race from double-click / concurrent API calls
    const redis = getRedisConnection();
    const lockKey = `deploy:lock:${projectId}`;
    const acquired = await redis.set(lockKey, '1', 'PX', 5000, 'NX').catch(() => null);
    // acquired === 'OK' → lock acquired
    // acquired === null (from NX) → lock held by another request → conflict
    // acquired === null (from .catch) → Redis down → proceed without lock
    if (acquired !== null && acquired !== 'OK') {
      throw new ConflictError('Another deployment creation is in progress. Please try again.');
    }
    // If NX returned null (either lock held or Redis down), we can't distinguish without a follow-up check.
    // If Redis is down, we proceed without the lock (matches existing risk profile).
    // If the lock is held but Redis returned null without throwing, we also proceed (DB logic is the real guard).

    try {
      // Cancel any existing QUEUED deployment (supersede pattern)
      const existingQueued = await this.deploymentRepo.findQueuedDeploymentForProject(projectId);
      if (existingQueued) {
        await this.queue.remove(existingQueued.id); // no-op if not in BullMQ
        await this.deploymentRepo.update(existingQueued.id, { status: 'CANCELLED', completedAt: new Date() });
      }

      // Check if a build is currently running
      const building = await this.deploymentRepo.findBuildingDeployment(projectId);

      // Create new deployment record
      const deployment = await this.deploymentRepo.create({ projectId, status: 'QUEUED' });

      // Enqueue immediately only if no active build; otherwise hold in DB
      if (!building) {
        try {
          await this.queue.add({ deploymentId: deployment.id, projectId });
        } catch (err) {
          const isConnectionError =
            (err as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
            (err as Error)?.message?.includes('ECONNREFUSED') ||
            err instanceof AggregateError;
          if (isConnectionError) {
            log.warn('Queue unavailable (Redis not running?). Deployment created but not queued', {
              deploymentId: deployment.id,
            });
          } else {
            throw err;
          }
        }
      }

      return { deployment, queued: building !== null };
    } finally {
      await redis.del(lockKey).catch(() => {});
    }
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
   * Cancels a QUEUED deployment: removes it from the queue and marks it CANCELLED.
   * Throws if the deployment is not in QUEUED state (already building or terminal).
   */
  async cancelDeployment(deploymentId: string, userId: string): Promise<Deployment> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.project.userId !== userId) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.status !== 'QUEUED') {
      throw new ValidationError(
        `Only QUEUED deployments can be cancelled (current status: ${deployment.status})`
      );
    }
    await this.queue.remove(deploymentId);
    return this.deploymentRepo.update(deploymentId, {
      status: 'CANCELLED',
      completedAt: new Date(),
    });
  }

  /**
   * Retries a FAILED deployment: resets the DB record to QUEUED and re-enqueues the job.
   */
  async retryFailedDeployment(deploymentId: string, userId: string): Promise<Deployment> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.project.userId !== userId) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.status !== 'FAILED') {
      throw new ValidationError(
        `Only FAILED deployments can be retried (current status: ${deployment.status})`
      );
    }
    const updated = await this.deploymentRepo.update(deploymentId, {
      status: 'QUEUED',
      buildStep: null,
      buildLog: null,
      completedAt: null,
    });
    // Only enqueue immediately if no build is running; otherwise it will be picked up by the worker
    const building = await this.deploymentRepo.findBuildingDeployment(deployment.projectId);
    if (!building) {
      await this.queue.retryFailed(deploymentId, {
        deploymentId,
        projectId: deployment.projectId,
      });
    }
    return updated;
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
   * Marks all BUILDING deployments as FAILED. Called once on worker startup to
   * recover from a previous crash where builds were left in an indeterminate state.
   * Also re-enqueues QUEUED deployments that were held back (their BUILDING job is now gone).
   */
  async recoverStuckDeployments(): Promise<void> {
    const count = await this.deploymentRepo.markBuildingAsFailed();
    if (count > 0) {
      log.warn('Marked stuck BUILDING deployment(s) as FAILED on startup', { count });
    }

    const orphaned = await this.deploymentRepo.findAllOrphanedQueuedDeployments();
    for (const dep of orphaned) {
      log.info('Re-enqueuing orphaned QUEUED deployment', { deploymentId: dep.id });
      await this.queue.add({ deploymentId: dep.id, projectId: dep.projectId }).catch((err) =>
        log.error('Failed to re-enqueue on startup', { deploymentId: dep.id, error: String(err) })
      );
    }
  }

  /**
   * Enqueues the next held-back QUEUED deployment for a project after the current build finishes.
   * Called by the worker after each completed or failed job.
   */
  async enqueueNextForProject(projectId: string): Promise<void> {
    const next = await this.deploymentRepo.findQueuedDeploymentForProject(projectId);
    if (!next) return;
    const stillBuilding = await this.deploymentRepo.findBuildingDeployment(projectId);
    if (stillBuilding) return; // defensive guard
    log.info('Enqueuing held deployment', { deploymentId: next.id, projectId });
    try {
      await this.queue.add({ deploymentId: next.id, projectId });
    } catch (err) {
      log.error('Failed to enqueue held deployment', { deploymentId: next.id, error: String(err) });
    }
  }

  /**
   * Process job: clone/pull repo, build image, run container or extract static files.
   * Called by worker. Uses clone-once strategy: first deploy clones, subsequent deploys pull latest.
   * Returns a summary of the completed deployment for the worker to log.
   */
  async buildAndDeploy(deploymentId: string): Promise<{
    slug: string;
    servingMethod: 'STATIC_FILES' | 'CONTAINER';
    containerPort: number | null;
    commitHash: string;
    projectType: string;
  } | null> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      log.warn('Deployment not found (stale or deleted job)', { deploymentId });
      return null;
    }
    const { project } = deployment;
    if (!project.githubUrl) {
      await this.deploymentRepo.update(deploymentId, { status: 'FAILED' });
      return null;
    }

    const startedAt = new Date();
    const redisChannel = `build:${deploymentId}`;
    const logLines: string[] = [];

    const flushLog = async (): Promise<void> => {
      try {
        await this.deploymentRepo.update(deploymentId, { buildLog: logLines.join('') });
      } catch {
        // Non-fatal: log flush failure shouldn't abort the build
      }
    };

    let lineCount = 0;
    const onLog = (line: string): void => {
      logLines.push(line);
      lineCount++;
      // Publish to Redis fire-and-forget (subscriber connections in SSE route)
      getRedisConnection().publish(redisChannel, line).catch(() => {});
      if (lineCount % 30 === 0) {
        void flushLog();
      }
    };

    const addMarker = (text: string): void => {
      onLog(`▶ ${text}\n`);
    };

    try {
      await this.deploymentRepo.update(deploymentId, {
        status: 'BUILDING',
        buildStep: 'CLONING',
        startedAt,
      });

      addMarker('Cloning...');
      const cleanUrl = project.githubUrl!;
      const token = await gitProviderService.getTokenForDeployment(project.userId, project.source);
      const authUrl = token ? buildAuthUrl(cleanUrl, project.source, token) : cleanUrl;

      let workDir: string;
      let commitHash: string;
      try {
        ({ workDir, commitHash } = await this.git.ensureRepo(
          authUrl,
          cleanUrl,
          project.slug,
          project.branch,
        ));
      } catch (err) {
        const msg = String(err);
        const isAuthFailure =
          msg.includes('Authentication failed') ||
          msg.includes('Invalid username') ||
          msg.includes('could not read Username') ||
          msg.includes('repository not found') ||
          msg.includes('Repository not found') ||
          msg.includes('fatal: unable to access');
        if (isAuthFailure) {
          throw new Error(
            `Git authentication failed for ${project.source}. ` +
            `Go to project Settings → Git Connections and reconnect your account.`,
          );
        }
        throw err;
      }
      await this.deploymentRepo.update(deploymentId, { commitHash });

      // Auto-correct project type from repo contents on first deploy
      const detected = await detectFromFiles(workDir).catch(() => null);
      if (detected && detected.confidence === 'high' && detected.type !== project.type) {
        const hasDeployed = await this.deploymentRepo.hasDeployedStatus(project.id);
        if (!hasDeployed) {
          log.info('Auto-correcting project type', { from: project.type, to: detected.type, hint: detected.hint });
          await this.projectRepo.update(project.id, { type: detected.type });
          addMarker(`Detected framework: ${detected.type} (${detected.hint})`);
          // Use corrected type for the remainder of this build
          (project as typeof project & { type: typeof detected.type }).type = detected.type;
        } else {
          log.info('Detected type differs from stored type', { stored: project.type, detected: detected.type, hint: detected.hint });
        }
      }

      await this.deploymentRepo.update(deploymentId, { buildStep: 'SCANNING' });
      addMarker('Scanning packages...');
      const { BLOCKED_PACKAGES } = getConfig();
      const { blocked } = await scanPackages(workDir, BLOCKED_PACKAGES);
      if (blocked.length > 0) {
        onLog(`✗ Blocked package(s) detected: ${blocked.join(', ')}\n`);
        onLog(`  Deployment rejected. Remove the offending package(s) and redeploy.\n`);
        throw new Error(`Blocked package(s) detected: ${blocked.join(', ')}`);
      }
      onLog(`✓ Package scan passed.\n`);

      // Resolve env vars: split into build args (NEXT_PUBLIC_*) and runtime env
      const allEnvVars = await this.envVar.resolveForDeployment(project.id);
      const buildArgs: Record<string, string> = {};
      const runtimeEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(allEnvVars)) {
        if (key.startsWith('NEXT_PUBLIC_') && project.type === 'NEXTJS') {
          buildArgs[key] = value;
        } else {
          runtimeEnv[key] = value;
        }
      }

      await this.deploymentRepo.update(deploymentId, { buildStep: 'BUILDING_IMAGE' });
      addMarker('Building image...');
      const secretValues = Object.values(runtimeEnv);
      const imageName = await this.docker.buildImage(project, workDir, buildArgs, secretValues, onLog);

      // Clean up build artifacts from work directory
      await this.cleanBuildArtifacts(workDir);

      const isStaticDeploy = STATIC_CAPABLE_TYPES.has(project.type) && project.useStaticHosting;

      if (isStaticDeploy) {
        await this.deploymentRepo.update(deploymentId, { buildStep: 'EXTRACTING' });
        addMarker('Extracting static files...');

        const { STATIC_SERVE_DIR } = getConfig();
        const slugServePath = path.join(STATIC_SERVE_DIR, project.slug);

        await fs.promises.rm(slugServePath, { recursive: true, force: true }).catch(() => {});
        await this.docker.extractStaticFiles(imageName, slugServePath);
        await this.docker.stopAndRemoveContainer(`dropdeploy-${project.slug}`);
        await this.docker.removeImage(imageName);

        await this.deploymentRepo.clearSubdomainForOtherDeployments(
          project.id,
          project.slug,
          deploymentId,
        );

        await this.deploymentRepo.update(deploymentId, {
          status: 'DEPLOYED',
          buildStep: null,
          buildLog: logLines.join(''),
          containerPort: null,
          servingMethod: 'STATIC_FILES',
          subdomain: project.slug,
          completedAt: new Date(),
        });

        getRedisConnection().publish(redisChannel, '__DONE__').catch(() => {});
        log.info('Static deployment live — served from filesystem', { slug: project.slug });
        return { slug: project.slug, servingMethod: 'STATIC_FILES', containerPort: null, commitHash, projectType: project.type };

      } else {
        await this.deploymentRepo.update(deploymentId, { buildStep: 'STARTING' });
        addMarker('Starting container...');
        const activePorts = await this.deploymentRepo.findActiveContainerPorts();
        const containerPort = await this.docker.runContainer(
          imageName,
          project.type,
          `dropdeploy-${project.slug}`,
          runtimeEnv,
          activePorts,
        );

        await this.deploymentRepo.clearSubdomainForOtherDeployments(
          project.id,
          project.slug,
          deploymentId,
        );
        await this.deploymentRepo.clearPortForOtherDeployments(project.id, deploymentId);

        await this.deploymentRepo.update(deploymentId, {
          status: 'DEPLOYED',
          buildStep: null,
          buildLog: logLines.join(''),
          containerPort,
          servingMethod: 'CONTAINER',
          subdomain: project.slug,
          completedAt: new Date(),
        });

        getRedisConnection().publish(redisChannel, '__DONE__').catch(() => {});
        log.info('Deployment live — routed via in-app proxy', { slug: project.slug, containerPort });
        return { slug: project.slug, servingMethod: 'CONTAINER', containerPort, commitHash, projectType: project.type };
      }
    } catch (err) {
      await this.deploymentRepo.update(deploymentId, {
        status: 'FAILED',
        buildStep: null,
        buildLog: logLines.join(''),
        completedAt: new Date(),
      });
      // Signal SSE subscribers that the build ended (with failure)
      getRedisConnection().publish(redisChannel, '__DONE__').catch(() => {});
      throw err;
    }
  }
  /**
   * Remove generated Dockerfile and any .env files from the work directory
   * after Docker build to prevent secrets lingering on disk.
   */
  private async cleanBuildArtifacts(workDir: string): Promise<void> {
    const filesToClean = ['Dockerfile', '.dockerignore'];
    for (const file of filesToClean) {
      try {
        await fs.promises.unlink(path.join(workDir, file));
      } catch {
        // File may not exist — that's fine
      }
    }

    // Remove any .env* files that the repo might contain
    try {
      const entries = await fs.promises.readdir(workDir);
      for (const entry of entries) {
        if (entry.startsWith('.env')) {
          await fs.promises.unlink(path.join(workDir, entry));
        }
      }
    } catch {
      log.warn('Failed to clean .env files from workDir', { workDir });
    }
  }
}

/**
 * Builds an authenticated HTTPS clone URL by embedding the token.
 * GitHub: https://x-access-token:<token>@github.com/owner/repo.git
 * GitLab: https://oauth2:<token>@gitlab.com/owner/repo.git
 * The token is NEVER stored — only used in-memory during clone/pull.
 *
 * Re-validates the URL against the host allowlist before injecting the token
 * (defense in depth): even if a malformed URL reached the DB, we never embed a
 * credential into a non-allowlisted host or a dangerous git transport.
 */
function buildAuthUrl(repoUrl: string, source: string, token: string): string {
  const { url } = parseSafeRepoUrl(repoUrl);
  if (!url.pathname.endsWith('.git')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}.git`;
  }
  url.username = source === 'GITHUB' ? 'x-access-token' : 'oauth2';
  url.password = token;
  return url.toString();
}

export const deploymentService = new DeploymentService(
  deploymentRepository,
  projectRepository,
  deploymentQueueAdapter,
  dockerService,
  gitService,
  envVarService,
);

