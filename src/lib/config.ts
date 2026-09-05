import { z } from 'zod';
import * as path from 'path';
import * as os from 'os';

const defaultBaseDir = path.join(os.homedir(), '.dropdeploy');

/**
 * Env booleans. NOTE: `z.coerce.boolean()` is wrong for env vars — it applies
 * JS truthiness, so the string "false" coerces to `true` and a kill-switch can
 * never be switched off. Only an explicit truthy token enables a flag.
 */
const envBool = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())));

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  JWT_SECRET: z.string().min(1).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  BASE_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_BASE_DOMAIN: z.string().min(1),
  ENV_ENCRYPTION_KEY: z.string().length(64, 'Must be a 64-char hex string (32 bytes)'),
  DOCKER_SOCKET: z.string().optional(),
  PROJECTS_DIR: z.string().default(path.join(defaultBaseDir, 'projects')),
  STATIC_SERVE_DIR: z.string().default(path.join(defaultBaseDir, 'static-sites')),
  DOCKER_DATA_DIR: z.string().default(path.join(defaultBaseDir, 'docker')),
  BULLMQ_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  BULLMQ_JOB_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(15 * 60 * 1000),
  CONTRIBUTOR_EMAIL: z.string().email().optional(),
  CONTRIBUTOR_PASSWORD: z.string().min(8).optional(),
  // Comma-separated list of blocked package names (npm, pip, etc.)
  // e.g. "malicious-pkg,evil-lib,badware"
  BLOCKED_PACKAGES: z.string().optional(),
  // Logging level: error | warn | info | http | verbose | debug | silly
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
  // OAuth — GitHub and GitLab (all optional; feature disabled when absent)
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITLAB_CLIENT_ID: z.string().optional(),
  GITLAB_CLIENT_SECRET: z.string().optional(),
  APP_URL: z.string().url().optional(),

  // ── Custom domains ───────────────────────────────────────────────────────
  // Master switch for the whole feature. When false the API rejects domain
  // mutations, the proxy never attempts host resolution, and the Caddy "ask"
  // endpoint refuses every issuance. This is the rollback lever.
  CUSTOM_DOMAINS_ENABLED: envBool(false),
  // Independent kill-switch for certificate issuance only. Lets you keep
  // routing for already-ACTIVE domains while stopping all new ACME orders.
  TLS_CHECK_ENABLED: envBool(false),
  // A-record target shown to users for apex domains.
  PLATFORM_INGRESS_IP: z.string().optional(),
  // CNAME target shown to users for sub-domains, e.g. "ingress.en3.wtf".
  CUSTOM_DOMAIN_CNAME_TARGET: z.string().optional(),
  // Shared secret the edge sends to /api/internal/tls-check. When set, the
  // endpoint requires it; the edge is the only party that should hold it.
  INTERNAL_EDGE_TOKEN: z.string().min(16).optional(),
  // Comma-separated hostnames that may never be claimed as custom domains.
  CUSTOM_DOMAIN_DENYLIST: z.string().optional(),
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
