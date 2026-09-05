import type { DomainRoute } from '@/repositories/domain.repository';

const findRoute = jest.fn<Promise<DomainRoute | null>, [string]>();
const redisGet = jest.fn<Promise<string | null>, [string]>();
const redisSet = jest.fn();
const redisDel = jest.fn();

jest.mock('@/repositories/domain.repository', () => ({
  domainRepository: { findRoute: (h: string) => findRoute(h) },
}));

jest.mock('@/lib/redis', () => ({
  getRedisConnection: () => ({
    get: (k: string) => redisGet(k),
    set: (...args: unknown[]) => redisSet(...args),
    del: (...args: unknown[]) => redisDel(...args),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveHostRoute, invalidateHost, __clearL1 } = require('@/lib/domain-resolver');

const ROUTE: DomainRoute = {
  hostname: 'myapp.com',
  slug: 'my-project',
  status: 'ACTIVE',
  isPrimary: true,
  redirectToPrimary: true,
  primaryHostname: 'myapp.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  __clearL1();
  redisGet.mockResolvedValue(null);
  redisSet.mockResolvedValue('OK');
  redisDel.mockResolvedValue(1);
});

describe('resolveHostRoute', () => {
  it('reads through to the database on a cold cache and populates both tiers', async () => {
    findRoute.mockResolvedValue(ROUTE);

    await expect(resolveHostRoute('myapp.com')).resolves.toEqual(ROUTE);

    expect(findRoute).toHaveBeenCalledTimes(1);
    expect(redisSet).toHaveBeenCalledWith(
      'domain-route:myapp.com',
      JSON.stringify(ROUTE),
      'EX',
      expect.any(Number),
    );
  });

  it('serves a repeat hit from memory without touching Redis or Postgres', async () => {
    findRoute.mockResolvedValue(ROUTE);

    await resolveHostRoute('myapp.com');
    await resolveHostRoute('myapp.com');
    await resolveHostRoute('myapp.com');

    expect(findRoute).toHaveBeenCalledTimes(1);
    expect(redisGet).toHaveBeenCalledTimes(1);
  });

  it('negative-caches an unknown host', async () => {
    // Without this, anyone pointing a hostname at the ingress IP — or simply
    // scanning it — turns every request into a database round trip.
    findRoute.mockResolvedValue(null);

    await expect(resolveHostRoute('attacker.com')).resolves.toBeNull();
    await expect(resolveHostRoute('attacker.com')).resolves.toBeNull();

    expect(findRoute).toHaveBeenCalledTimes(1);
  });

  it('promotes an L2 hit into L1 without querying the database', async () => {
    redisGet.mockResolvedValue(JSON.stringify(ROUTE));

    await expect(resolveHostRoute('myapp.com')).resolves.toEqual(ROUTE);

    expect(findRoute).not.toHaveBeenCalled();
  });

  it('normalises the Host header before looking up', async () => {
    findRoute.mockResolvedValue(ROUTE);

    // A dev request carries a port; a fully-qualified Host carries a trailing
    // dot. The stored hostname has neither.
    await resolveHostRoute('MyApp.com:3001');
    expect(findRoute).toHaveBeenCalledWith('myapp.com');

    __clearL1();
    redisGet.mockResolvedValue(null);
    await resolveHostRoute('myapp.com.');
    expect(findRoute).toHaveBeenLastCalledWith('myapp.com');
  });

  it('falls back to Postgres when Redis is unavailable', async () => {
    // A cache outage must degrade to a slower request, not a failed one.
    redisGet.mockRejectedValue(new Error('ECONNREFUSED'));
    redisSet.mockRejectedValue(new Error('ECONNREFUSED'));
    findRoute.mockResolvedValue(ROUTE);

    await expect(resolveHostRoute('myapp.com')).resolves.toEqual(ROUTE);
  });
});

describe('invalidateHost', () => {
  it('forces the next lookup back to the database', async () => {
    findRoute.mockResolvedValue(ROUTE);
    await resolveHostRoute('myapp.com');
    expect(findRoute).toHaveBeenCalledTimes(1);

    await invalidateHost('myapp.com');

    await resolveHostRoute('myapp.com');
    expect(findRoute).toHaveBeenCalledTimes(2);
    expect(redisDel).toHaveBeenCalledWith('domain-route:myapp.com');
  });

  it('clears a negative entry too, so a newly added domain resolves at once', async () => {
    findRoute.mockResolvedValue(null);
    await resolveHostRoute('new.com');

    await invalidateHost('new.com');
    findRoute.mockResolvedValue(ROUTE);

    await expect(resolveHostRoute('new.com')).resolves.toEqual(ROUTE);
  });

  it('is a no-op when given nothing', async () => {
    await invalidateHost();
    expect(redisDel).not.toHaveBeenCalled();
  });
});
