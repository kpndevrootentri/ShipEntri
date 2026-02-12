import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? '6379', 10);

/**
 * Redis connection for BullMQ and caching.
 * Use getRedisConnection() in server/worker context only.
 */
function createRedisConnection(): Redis {
  return new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null,
  });
}

let redis: Redis | null = null;

/**
 * Returns a shared Redis connection for the current process.
 * Call in API routes, server components, or workers.
 */
export function getRedisConnection(): Redis {
  if (!redis) {
    redis = createRedisConnection();
  }
  return redis;
}

/**
 * Closes the Redis connection. Call during graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
