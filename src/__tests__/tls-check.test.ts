import { NextRequest } from 'next/server';

const isIssuanceAllowed = jest.fn<Promise<boolean>, [string]>();
const getConfig = jest.fn();

jest.mock('@/services/domain', () => ({
  domainService: { isIssuanceAllowed: (h: string) => isIssuanceAllowed(h) },
}));

jest.mock('@/lib/config', () => ({
  getConfig: () => getConfig(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('@/app/api/internal/tls-check/route');

const TOKEN = 'edge-token-0123456789abcdef';

function baseConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CUSTOM_DOMAINS_ENABLED: true,
    TLS_CHECK_ENABLED: true,
    INTERNAL_EDGE_TOKEN: TOKEN,
    ...over,
  };
}

/** Builds the request Caddy's `ask` makes: a plain GET with query params. */
function ask(params: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
  const url = new URL('http://127.0.0.1:3001/api/internal/tls-check');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue(baseConfig());
  isIssuanceAllowed.mockResolvedValue(true);
  // Each test drives the rate limiter, which is keyed by hostname and shared
  // across the module — unique hostnames keep the cases independent.
});

let n = 0;
const uniqueHost = (): string => `host-${n++}.example.com`;

describe('GET /api/internal/tls-check', () => {
  it('authorises issuance for a verified domain with a valid token', async () => {
    const res = await GET(ask({ domain: uniqueHost(), token: TOKEN }));
    expect(res.status).toBe(200);
  });

  it('accepts the token as a header as well as a query parameter', async () => {
    const res = await GET(ask({ domain: uniqueHost() }, { 'x-internal-edge-token': TOKEN }));
    expect(res.status).toBe(200);
  });

  it('denies a request with no token', async () => {
    const res = await GET(ask({ domain: uniqueHost() }));
    expect(res.status).toBe(403);
    expect(isIssuanceAllowed).not.toHaveBeenCalled();
  });

  it('denies a request with the wrong token', async () => {
    const res = await GET(ask({ domain: uniqueHost(), token: 'wrong-token-0123456789ab' }));
    expect(res.status).toBe(403);
    expect(isIssuanceAllowed).not.toHaveBeenCalled();
  });

  it('denies a token of the right value but different length', async () => {
    const res = await GET(ask({ domain: uniqueHost(), token: `${TOKEN}x` }));
    expect(res.status).toBe(403);
  });

  it('fails closed when no edge token is configured', async () => {
    // An unset secret must not degrade into an open endpoint — that is exactly
    // the state in which someone could drive certificate orders at will.
    getConfig.mockReturnValue(baseConfig({ INTERNAL_EDGE_TOKEN: undefined }));
    const res = await GET(ask({ domain: uniqueHost(), token: TOKEN }));
    expect(res.status).toBe(403);
  });

  it('denies a domain the service has not verified', async () => {
    isIssuanceAllowed.mockResolvedValue(false);
    const res = await GET(ask({ domain: uniqueHost(), token: TOKEN }));
    expect(res.status).toBe(403);
  });

  it('denies a request with no domain parameter', async () => {
    const res = await GET(ask({ token: TOKEN }));
    expect(res.status).toBe(403);
  });

  it.each([
    ['the feature flag is off', { CUSTOM_DOMAINS_ENABLED: false }],
    ['issuance is switched off', { TLS_CHECK_ENABLED: false }],
  ])('denies everything when %s', async (_label, over) => {
    getConfig.mockReturnValue(baseConfig(over));
    const res = await GET(ask({ domain: uniqueHost(), token: TOKEN }));
    expect(res.status).toBe(403);
  });

  it('fails closed when the lookup throws', async () => {
    isIssuanceAllowed.mockRejectedValue(new Error('database is down'));
    const res = await GET(ask({ domain: uniqueHost(), token: TOKEN }));
    expect(res.status).toBe(403);
  });

  it('rate-limits repeated asks for the same hostname', async () => {
    // Bounds how fast one hostname can drive ACME orders, which is what
    // protects the shared Let's Encrypt weekly quota.
    const host = uniqueHost();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      codes.push((await GET(ask({ domain: host, token: TOKEN }))).status);
    }
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.slice(5)).toEqual([403, 403, 403]);
  });
});
