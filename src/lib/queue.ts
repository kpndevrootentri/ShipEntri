import { Queue } from 'bullmq';
import { getRedisConnection } from '@/lib/redis';
import type { DeploymentJob } from '@/types/deployment.types';

const QUEUE_NAME = 'deployments';

let deploymentQueue: Queue<DeploymentJob> | null = null;

/**
 * Returns the deployment queue instance (BullMQ).
 * Use in API routes or server context only.
 */
export function getDeploymentQueue(): Queue<DeploymentJob> {
  if (!deploymentQueue) {
    deploymentQueue = new Queue<DeploymentJob>(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
      },
    });
  }
  return deploymentQueue as Queue<DeploymentJob>;
}

export interface IDeploymentQueue {
  add(job: DeploymentJob): Promise<string>;
}

export const deploymentQueueAdapter: IDeploymentQueue = {
  async add(job: DeploymentJob): Promise<string> {
    const result = await getDeploymentQueue().add('deploy', job);
    return result.id ?? '';
  },
};
