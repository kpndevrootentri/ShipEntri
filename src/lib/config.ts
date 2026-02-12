import { z } from 'zod';
import * as path from 'path';
import * as os from 'os';

const defaultBaseDir = path.join(os.homedir(), '.dropdeploy');

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  JWT_SECRET: z.string().min(1).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  BASE_DOMAIN: z.string().default('dropdeploy.app'),
  DOCKER_SOCKET: z.string().optional(),
  PROJECTS_DIR: z.string().default(path.join(defaultBaseDir, 'projects')),
  DOCKER_DATA_DIR: z.string().default(path.join(defaultBaseDir, 'docker')),
});

type Env = z.infer<typeof envSchema>;

let config: Env | null = null;

/**
 * Validated environment config. Call after env is loaded.
 * In development, missing JWT_SECRET is allowed.
 */
export function getConfig(): Env {
  if (config) return config;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${parsed.error.message}`);
  }
  config = parsed.data;
  return config;
}

export const isDevelopment = (): boolean => getConfig().NODE_ENV === 'development';
export const isProduction = (): boolean => getConfig().NODE_ENV === 'production';
export const isTest = (): boolean => getConfig().NODE_ENV === 'test';
