import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { domainService } from '@/services/domain';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { checkTlsAskRateLimit } from '@/lib/rate-limit';

const log = createLogger('tls-check');

/** Constant-time comparison that does not leak the secret's length. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * GET /api/internal/tls-check?domain=example.com — Caddy's on-demand TLS "ask" hook.
 *
 * Caddy calls this during the TLS handshake for a hostname it has no
 * certificate for. `200` means "go ahead and order one from Let's Encrypt";
 * anything else means no certificate and a failed handshake.
 *
 * That makes this endpoint a security boundary rather than a lookup:
 *
 *   - It is deny-by-default. Every failure mode — missing token, missing
 *     domain, unknown host, feature flag off — returns 403.
 *   - It requires the shared edge token. Without it, anyone who can reach the
 *     app could make the platform order certificates, exhausting the Let's
 *     Encrypt rate limit (50 certs per registered domain per week) for real
 *     tenants and opening a domain-fronting path.
 *   - It is rate-limited per hostname, because a scanner pointing many names
 *     at the ingress IP would otherwise get one database lookup per handshake.
 *
 * It must also be bound to loopback or an edge-only network at the reverse
 * proxy; the token is defence in depth, not the only control.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  const deny = (reason: string, domain: string | null): NextResponse => {
    log.warn('TLS issuance denied', { reason, domain });
    return new NextResponse(null, { status: 403 });
  };

  try {
    const config = getConfig();
    const domain = req.nextUrl.searchParams.get('domain');

    if (!config.CUSTOM_DOMAINS_ENABLED || !config.TLS_CHECK_ENABLED) {
      return deny('feature-disabled', domain);
    }

    // Issuance is never allowed without a configured token — an unset secret
    // must fail closed, not degrade to an open endpoint.
    const expected = config.INTERNAL_EDGE_TOKEN;
    if (!expected) {
      return deny('no-edge-token-configured', domain);
    }

    const provided =
      req.headers.get('x-internal-edge-token') ?? req.nextUrl.searchParams.get('token');
    if (!secretMatches(provided, expected)) {
      return deny('bad-edge-token', domain);
    }

    if (!domain) {
      return deny('no-domain', null);
    }

    const limited = checkTlsAskRateLimit(domain);
    if (limited) {
      return deny('rate-limited', domain);
    }

    const allowed = await domainService.isIssuanceAllowed(domain);
    if (!allowed) {
      return deny('not-verified', domain);
    }

    log.info('TLS issuance allowed', { domain });
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    // Fail closed: an internal error must never become an open ask endpoint.
    log.error('TLS check errored', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(null, { status: 403 });
  }
}
