/**
 * Docker service: build images from project context and run containers (PRD §5.4).
 */

import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import type { Project } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { DOCKERFILE_TEMPLATES, CONTAINER_PORTS, type DockerfileProjectType } from './dockerfile.templates';
import { patchNextConfig } from './nextjs-config-patcher';

export interface DockerServiceConfig {
  socketPath?: string;
  memoryLimitBytes?: number;
  cpuShares?: number;
}

export class DockerService {
  private docker: Docker;
  private memoryLimitBytes: number;
  private cpuShares: number;

  constructor (config: DockerServiceConfig = {}) {
    const socketPath =
      config.socketPath ?? getConfig().DOCKER_SOCKET ?? '/var/run/docker.sock';
    this.docker = new Docker({ socketPath });
    this.memoryLimitBytes = config.memoryLimitBytes ?? 512 * 1024 * 1024;
    this.cpuShares = config.cpuShares ?? 1024;
  }

  /**
   * Returns Dockerfile content for the given project type.
   */
  getDockerfileForProject(project: Project): string {
    const key =
      project.type in DOCKERFILE_TEMPLATES ? project.type : 'STATIC';
    return DOCKERFILE_TEMPLATES[key as keyof typeof DOCKERFILE_TEMPLATES];
  }

  /**
   * Writes Dockerfile to context path, then builds image using dockerode.
   * Context path must contain cloned repo files.
   */
  async buildImage(project: Project, contextPath: string): Promise<string> {
    const imageName = `dropdeploy/${project.slug}:latest`;
    const dockerfile = this.getDockerfileForProject(project);
    const dockerfilePath = path.join(contextPath, 'Dockerfile');
    await fs.promises.writeFile(dockerfilePath, dockerfile, 'utf8');

    // Patch Next.js config to skip lint/type errors during build
    if (project.type === 'NEXTJS') {
      await patchNextConfig(contextPath);
    }

    console.log('[docker] Building image:', imageName);
    const stream = await this.docker.buildImage(
      { context: contextPath, src: ['.'] },
      { t: imageName }
    );

    // Collect build output for diagnostics
    const buildLog: string[] = [];
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null, output: Array<{ stream?: string; error?: string; errorDetail?: { message?: string } }>) => {
          if (err) {
            reject(err);
            return;
          }
          const buildError = output?.find((o) => o.error ?? o.errorDetail);
          if (buildError) {
            const msg =
              buildError.error ??
              buildError.errorDetail?.message ??
              'Docker build failed';
            const tail = buildLog.slice(-20).join('');
            reject(new Error(`${msg}\n\nBuild output (last 20 lines):\n${tail}`));
            return;
          }
          resolve();
        },
        (event: { stream?: string; error?: string }) => {
          if (event.stream) {
            buildLog.push(event.stream);
          }
        }
      );
    });

    // Verify the image exists (Docker build can "succeed" from stream perspective but fail to produce an image).
    try {
      await this.docker.getImage(imageName).inspect();
    } catch {
      throw new Error(
        'Docker build did not produce an image. For Node.js: ensure package.json has a "start" script (e.g. "node index.js"). Check your repo and try again.'
      );
    }

    return imageName;
  }

  /**
   * Creates and starts a container from the image; returns the host port.
   * Static projects expose 80, Node/Next expose 3000.
   */
  async runContainer(imageName: string, projectType: string, containerName?: string): Promise<number> {
    try {
      await this.docker.getImage(imageName).inspect();
    } catch {
      throw new Error(
        `Image ${imageName} was not found. The Docker build likely failed. For Node.js: ensure package.json has a "start" script (e.g. "node index.js") and that the repo builds. Check deployment logs.`
      );
    }

    // Stop and remove existing container with the same name (redeploy scenario)
    if (containerName) {
      try {
        const existing = this.docker.getContainer(containerName);
        const info = await existing.inspect();
        if (info.State.Running) {
          await existing.stop();
        }
        await existing.remove();
      } catch {
        // Container doesn't exist — that's fine
      }
    }

    const containerPort = CONTAINER_PORTS[projectType as DockerfileProjectType] ?? 3000;
    const hostPort = await this.findAvailablePort();

    const container = await this.docker.createContainer({
      Image: imageName,
      name: containerName,
      ExposedPorts: { [`${containerPort}/tcp`]: {} },
      HostConfig: {
        PortBindings: {
          [`${containerPort}/tcp`]: [{ HostPort: String(hostPort) }],
        },
        Memory: this.memoryLimitBytes,
        CpuShares: this.cpuShares,
      },
    });

    await container.start();
    return hostPort;
  }

  /**
   * Find an available host port in a range (avoids conflicts).
   */
  async findAvailablePort(): Promise<number> {
    const base = 8000;
    const range = 2000;
    return base + Math.floor(Math.random() * range);
  }
}

export const dockerService = new DockerService();
