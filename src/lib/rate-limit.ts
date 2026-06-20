import { NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ENV_VAR_WINDOW_MS = 60_000; // 1 minute
const ENV_VAR_MAX_REQUESTS = 60; // 60 requests per minute per user

const WEBHOOK_WINDOW_MS = 60_000; // 1 minute
const WEBHOOK_MAX_REQUESTS = 60; // 60 deliveries per minute per source

// NOTE: this store is in-memory and per-process. It does NOT span multiple
// instances or survive a restart. Fine for a single-instance deployment; if
// DropDeploy is scaled horizontally, back this with Redis (getRedisConnection).
const store = new Map<string, RateLimitEntry>();

// Periodically clean expired entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000);

/**
 * Generic in-memory fixed-window rate limiter.
 * Returns a 429 NextResponse if the limit is exceeded, or null if allowed.
 */
export function checkRateLimit(key: string, opts: { windowMs: number; max: number }): NextResponse | null {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > opts.max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      },
    );
  }

  return null;
}

/** Rate limit env var API endpoints — 60 req/min/user. */
export function checkEnvVarRateLimit(userId: string): NextResponse | null {
  return checkRateLimit(`env-var:${userId}`, { windowMs: ENV_VAR_WINDOW_MS, max: ENV_VAR_MAX_REQUESTS });
}

/** Rate limit the public webhook endpoint — 60 deliveries/min keyed by source (IP/repo). */
export function checkWebhookRateLimit(source: string): NextResponse | null {
  return checkRateLimit(`webhook:${source}`, { windowMs: WEBHOOK_WINDOW_MS, max: WEBHOOK_MAX_REQUESTS });
}
