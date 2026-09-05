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

// Periodically clean expired entries to prevent memory leaks.
// unref() so this timer never by itself keeps the process alive: a long-lived
// server ignores it, while a short-lived one (a test run, a script) can still
// exit instead of hanging on the sweep.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000);
sweep.unref?.();

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

const DOMAIN_MUTATION_WINDOW_MS = 60_000; // 1 minute
const DOMAIN_MUTATION_MAX = 20; // 20 add/patch calls per minute per user

const DOMAIN_VERIFY_WINDOW_MS = 60_000; // 1 minute
const DOMAIN_VERIFY_MAX = 6; // 6 manual DNS checks per minute per user

const TLS_ASK_WINDOW_MS = 60_000; // 1 minute
const TLS_ASK_MAX = 5; // matches Caddy's own on-demand burst

/** Rate limit custom-domain add/update — 20 req/min/user. */
export function checkDomainMutationRateLimit(userId: string): NextResponse | null {
  return checkRateLimit(`domain:${userId}`, {
    windowMs: DOMAIN_MUTATION_WINDOW_MS,
    max: DOMAIN_MUTATION_MAX,
  });
}

/**
 * Rate limit manual DNS verification — 6 req/min/user.
 * Tighter than the other mutations because each call fans out to several
 * outbound DNS queries against a hostname the user chose.
 */
export function checkDomainVerifyRateLimit(userId: string): NextResponse | null {
  return checkRateLimit(`domain-verify:${userId}`, {
    windowMs: DOMAIN_VERIFY_WINDOW_MS,
    max: DOMAIN_VERIFY_MAX,
  });
}

/**
 * Rate limit the Caddy ask endpoint, keyed by the hostname being asked about.
 * Bounds how fast a single hostname can drive certificate orders, which is what
 * protects the shared Let's Encrypt quota.
 */
export function checkTlsAskRateLimit(hostname: string): NextResponse | null {
  return checkRateLimit(`tls-ask:${hostname.toLowerCase()}`, {
    windowMs: TLS_ASK_WINDOW_MS,
    max: TLS_ASK_MAX,
  });
}
