import type { CustomDomain, DomainStatus } from '@prisma/client';
import { DomainService, VERIFY_LABEL, VERIFY_PREFIX } from '@/services/domain/domain.service';
import type { IDomainRepository, DomainRoute } from '@/repositories/domain.repository';
import type { IDnsResolver } from '@/lib/dns-resolver';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
  QuotaExceededError,
} from '@/lib/errors';

// The resolver's cache invalidation reaches for Redis and Prisma; nothing in
// these tests depends on it, so stub the whole module out.
jest.mock('@/lib/domain-resolver', () => ({
  invalidateHost: jest.fn().mockResolvedValue(undefined),
  promoteHostToActive: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID = 'user-1';
const PROJECT_ID = 'project-1';
const TOKEN = 'tok-abc123';

const CONFIG = {
  BASE_DOMAIN: 'app.en3.wtf',
  APP_URL: 'https://app.en3.wtf',
  NEXT_PUBLIC_APP_URL: 'https://app.en3.wtf',
  CUSTOM_DOMAIN_DENYLIST: undefined,
  CUSTOM_DOMAINS_ENABLED: true,
  TLS_CHECK_ENABLED: true,
  PLATFORM_INGRESS_IP: '203.0.113.10',
  CUSTOM_DOMAIN_CNAME_TARGET: 'ingress.en3.wtf',
};

function makeDomain(over: Partial<CustomDomain> = {}): CustomDomain {
  return {
    id: 'domain-1',
    hostname: 'myapp.com',
    projectId: PROJECT_ID,
    status: 'PENDING_DNS',
    isPrimary: false,
    redirectToPrimary: true,
    verificationToken: TOKEN,
    verifiedAt: null,
    lastCheckedAt: null,
    lastError: null,
    failureCount: 0,
    certIssuedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  } as CustomDomain;
}

interface Harness {
  service: DomainService;
  domainRepo: jest.Mocked<IDomainRepository>;
  dns: jest.Mocked<IDnsResolver>;
  store: Map<string, CustomDomain>;
}

function harness(opts: {
  domains?: CustomDomain[];
  projectOwner?: string | null;
  domainQuota?: number;
  config?: Partial<typeof CONFIG>;
} = {}): Harness {
  const store = new Map<string, CustomDomain>();
  for (const d of opts.domains ?? []) store.set(d.id, d);

  const domainRepo: jest.Mocked<IDomainRepository> = {
    findById: jest.fn(async (id) => store.get(id) ?? null),
    findByHostname: jest.fn(
      async (h) => [...store.values()].find((d) => d.hostname === h) ?? null,
    ),
    listByProject: jest.fn(async (pid) => [...store.values()].filter((d) => d.projectId === pid)),
    countByUser: jest.fn<Promise<number>, [string]>(async () => store.size),
    create: jest.fn(async (data) => {
      const created = makeDomain({ id: `domain-${store.size + 1}`, ...data });
      store.set(created.id, created);
      return created;
    }),
    update: jest.fn(async (id, data) => {
      const current = store.get(id)!;
      const next = { ...current, ...(data as Partial<CustomDomain>) };
      store.set(id, next);
      return next;
    }),
    delete: jest.fn(async (id) => {
      store.delete(id);
    }),
    setPrimary: jest.fn(async (pid, id) => {
      for (const [k, v] of store) {
        if (v.projectId === pid) store.set(k, { ...v, isPrimary: k === id });
      }
      return store.get(id)!;
    }),
    findRoute: jest.fn<Promise<DomainRoute | null>, [string]>(async () => null),
    findDueForRecheck: jest.fn<Promise<CustomDomain[]>, [Date, number]>(async () => []),
  };

  const projectRepo = {
    findById: jest.fn(async (id: string) =>
      opts.projectOwner === null
        ? null
        : { id, userId: opts.projectOwner ?? OWNER_ID, slug: 'my-project' },
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const userRepo = {
    findById: jest.fn(async (id: string) => ({ id, domainQuota: opts.domainQuota ?? 5 })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const auditRepo = { create: jest.fn(async () => ({})) as unknown } as never;

  const dns: jest.Mocked<IDnsResolver> = {
    resolveTxt: jest.fn<Promise<string[]>, [string]>(async () => []),
    resolveA: jest.fn<Promise<string[]>, [string]>(async () => []),
    resolveCname: jest.fn<Promise<string[]>, [string]>(async () => []),
    resolveCaa: jest.fn<Promise<{ issue?: string }[]>, [string]>(async () => []),
  };

  const cfg = (() => ({ ...CONFIG, ...opts.config })) as never;

  return {
    service: new DomainService(domainRepo, projectRepo, userRepo, auditRepo, dns, cfg),
    domainRepo,
    dns,
    store,
  };
}

/** DNS state in which both signals succeed. */
function happyDns(h: Harness, hostname = 'myapp.com'): void {
  h.dns.resolveTxt.mockResolvedValue([`${VERIFY_PREFIX}${TOKEN}`]);
  h.dns.resolveCname.mockResolvedValue([CONFIG.CUSTOM_DOMAIN_CNAME_TARGET]);
  h.dns.resolveA.mockResolvedValue([CONFIG.PLATFORM_INGRESS_IP]);
  void hostname;
}

// ---------------------------------------------------------------------------
// Ownership / tenancy
// ---------------------------------------------------------------------------

describe('ownership enforcement', () => {
  it('reports a project owned by someone else as not found, never as forbidden', async () => {
    // Surfacing 403 here would confirm the project id exists, turning the
    // endpoint into an enumeration oracle.
    const { service } = harness({ projectOwner: 'someone-else' });
    await expect(service.list(PROJECT_ID, OWNER_ID)).rejects.toThrow(NotFoundError);
    await expect(service.add(PROJECT_ID, OWNER_ID, { hostname: 'x.com' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('refuses to act on a domain id belonging to another project', async () => {
    const foreign = makeDomain({ id: 'domain-9', projectId: 'other-project' });
    const { service } = harness({ domains: [foreign] });
    await expect(service.verify(PROJECT_ID, OWNER_ID, 'domain-9')).rejects.toThrow(NotFoundError);
    await expect(service.remove(PROJECT_ID, OWNER_ID, 'domain-9')).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// add()
// ---------------------------------------------------------------------------

describe('add', () => {
  it('normalises the hostname before storing it', async () => {
    const { service, store } = harness();
    const view = await service.add(PROJECT_ID, OWNER_ID, { hostname: 'https://MyApp.COM/path' });
    expect(view.hostname).toBe('myapp.com');
    expect([...store.values()][0].hostname).toBe('myapp.com');
  });

  it('mints a distinct verification token per domain', async () => {
    const { service } = harness();
    const a = await service.add(PROJECT_ID, OWNER_ID, { hostname: 'a.com' });
    const b = await service.add(PROJECT_ID, OWNER_ID, { hostname: 'b.com' });
    const tokenOf = (v: typeof a): string =>
      v.dnsRecords.find((r) => r.kind === 'TXT')!.value;
    expect(tokenOf(a)).not.toBe(tokenOf(b));
  });

  it('rejects a hostname under the platform base domain', async () => {
    const { service } = harness();
    await expect(
      service.add(PROJECT_ID, OWNER_ID, { hostname: 'evil.app.en3.wtf' }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a hostname already claimed by another project', async () => {
    const taken = makeDomain({ id: 'domain-x', hostname: 'taken.com', projectId: 'other' });
    const { service } = harness({ domains: [taken] });
    await expect(service.add(PROJECT_ID, OWNER_ID, { hostname: 'taken.com' })).rejects.toThrow(
      ConflictError,
    );
  });

  it('translates a unique-constraint race into a conflict', async () => {
    // Two requests can pass the pre-check simultaneously; the DB index is the
    // real lock, and its error must not surface as a 500.
    const { service, domainRepo } = harness();
    domainRepo.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(service.add(PROJECT_ID, OWNER_ID, { hostname: 'race.com' })).rejects.toThrow(
      ConflictError,
    );
  });

  it('enforces the per-user domain quota across all their projects', async () => {
    const existing = makeDomain({ id: 'domain-a', hostname: 'one.com' });
    const { service } = harness({ domains: [existing], domainQuota: 1 });
    await expect(service.add(PROJECT_ID, OWNER_ID, { hostname: 'two.com' })).rejects.toThrow(
      QuotaExceededError,
    );
  });

  it('refuses every mutation while the feature flag is off', async () => {
    const { service } = harness({ config: { CUSTOM_DOMAINS_ENABLED: false } });
    await expect(service.add(PROJECT_ID, OWNER_ID, { hostname: 'x.com' })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

// ---------------------------------------------------------------------------
// runCheck() — the verification state machine
// ---------------------------------------------------------------------------

describe('runCheck', () => {
  it('queries the TXT record at the verification label, not the bare hostname', async () => {
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    await h.service.runCheck(domain);
    expect(h.dns.resolveTxt).toHaveBeenCalledWith(`${VERIFY_LABEL}.myapp.com`);
  });

  it('stays PENDING_DNS when the TXT record is absent', async () => {
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    const result = await h.service.runCheck(domain);
    expect(result.status).toBe<DomainStatus>('PENDING_DNS');
    expect(result.ownershipVerified).toBe(false);
    expect(result.message).toMatch(/No TXT record/);
  });

  it('rejects a TXT record carrying a different token', async () => {
    // A stale token from an earlier add must not verify the new claim.
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    h.dns.resolveTxt.mockResolvedValue([`${VERIFY_PREFIX}some-other-token`]);
    const result = await h.service.runCheck(domain);
    expect(result.ownershipVerified).toBe(false);
    expect(result.message).toMatch(/does not match/);
  });

  it('reaches VERIFIED on ownership alone when the domain does not point at us yet', async () => {
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    h.dns.resolveTxt.mockResolvedValue([`${VERIFY_PREFIX}${TOKEN}`]);
    const result = await h.service.runCheck(domain);
    expect(result.status).toBe<DomainStatus>('VERIFIED');
    expect(result.routingVerified).toBe(false);
    expect(result.message).toMatch(/CNAME|A record/);
  });

  it('reaches PROVISIONING once both ownership and routing check out', async () => {
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    happyDns(h);
    const result = await h.service.runCheck(domain);
    expect(result.status).toBe<DomainStatus>('PROVISIONING');
    expect(result.ownershipVerified && result.routingVerified).toBe(true);
    expect(h.store.get('domain-1')!.verifiedAt).not.toBeNull();
  });

  it('accepts an A record pointing at the ingress IP when no CNAME is used', async () => {
    // Apex domains cannot CNAME, so the A path has to work on its own.
    const domain = makeDomain({ hostname: 'apex.com' });
    const h = harness({ domains: [domain] });
    h.dns.resolveTxt.mockResolvedValue([`${VERIFY_PREFIX}${TOKEN}`]);
    h.dns.resolveCname.mockResolvedValue([]);
    h.dns.resolveA.mockResolvedValue([CONFIG.PLATFORM_INGRESS_IP]);
    const result = await h.service.runCheck(domain);
    expect(result.routingVerified).toBe(true);
  });

  it('does not treat an A record for someone else’s IP as routing to us', async () => {
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    h.dns.resolveTxt.mockResolvedValue([`${VERIFY_PREFIX}${TOKEN}`]);
    h.dns.resolveA.mockResolvedValue(['198.51.100.7']);
    const result = await h.service.runCheck(domain);
    expect(result.routingVerified).toBe(false);
  });

  it('joins split TXT chunks before comparing', async () => {
    // DNS splits long TXT values into 255-byte chunks; the resolver rejoins
    // them, and the comparison must work on the rejoined value.
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    h.dns.resolveTxt.mockResolvedValue([`${VERIFY_PREFIX}${TOKEN}`]);
    const result = await h.service.runCheck(domain);
    expect(result.ownershipVerified).toBe(true);
  });

  it('fails with a CAA explanation when the record excludes our CA', async () => {
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    happyDns(h);
    h.dns.resolveCaa.mockResolvedValue([{ issue: 'digicert.com' }]);
    const result = await h.service.runCheck(domain);
    expect(result.status).toBe<DomainStatus>('FAILED');
    expect(result.message).toMatch(/CAA/);
  });

  it('passes when a CAA record explicitly allows Let’s Encrypt', async () => {
    const domain = makeDomain();
    const h = harness({ domains: [domain] });
    happyDns(h);
    h.dns.resolveCaa.mockResolvedValue([{ issue: 'letsencrypt.org' }]);
    const result = await h.service.runCheck(domain);
    expect(result.status).toBe<DomainStatus>('PROVISIONING');
  });

  it('keeps an ACTIVE domain live through a single failed re-check', async () => {
    // A DNS blip must not take a customer's site down.
    const domain = makeDomain({ status: 'ACTIVE', verifiedAt: new Date(), failureCount: 0 });
    const h = harness({ domains: [domain] });
    const result = await h.service.runCheck(domain);
    expect(result.status).toBe<DomainStatus>('ACTIVE');
    expect(h.store.get('domain-1')!.failureCount).toBe(1);
  });

  it('tears an ACTIVE domain down after repeated failures', async () => {
    // The dangling-DNS defence: a hostname whose owner pulled the record must
    // stop being served before someone else can pick the domain up.
    const domain = makeDomain({ status: 'ACTIVE', verifiedAt: new Date(), failureCount: 4 });
    const h = harness({ domains: [domain] });
    const result = await h.service.runCheck(domain);
    expect(result.status).toBe<DomainStatus>('FAILED');
  });

  it('does not count a resolver outage against the domain', async () => {
    // Our infrastructure failing is not the user's misconfiguration.
    const domain = makeDomain({ status: 'ACTIVE', verifiedAt: new Date(), failureCount: 3 });
    const h = harness({ domains: [domain] });
    h.dns.resolveTxt.mockRejectedValue(Object.assign(new Error('SERVFAIL'), { code: 'ESERVFAIL' }));
    const result = await h.service.runCheck(domain);
    expect(result.status).toBe<DomainStatus>('ACTIVE');
    expect(h.store.get('domain-1')!.failureCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// isIssuanceAllowed() — the Caddy ask decision
// ---------------------------------------------------------------------------

describe('isIssuanceAllowed', () => {
  it.each<[DomainStatus, boolean]>([
    ['PENDING_DNS', false],
    ['VERIFYING', false],
    ['FAILED', false],
    ['VERIFIED', true],
    ['PROVISIONING', true],
    ['ACTIVE', true],
  ])('status %s → %s', async (status, expected) => {
    const h = harness({ domains: [makeDomain({ status })] });
    await expect(h.service.isIssuanceAllowed('myapp.com')).resolves.toBe(expected);
  });

  it('refuses a hostname that is not in the table at all', async () => {
    // This is the control that stops a scanner pointing arbitrary names at the
    // ingress IP and burning the Let's Encrypt quota.
    const h = harness();
    await expect(h.service.isIssuanceAllowed('attacker.com')).resolves.toBe(false);
  });

  it('refuses malformed input without throwing', async () => {
    const h = harness({ domains: [makeDomain({ status: 'ACTIVE' })] });
    await expect(h.service.isIssuanceAllowed('not a hostname')).resolves.toBe(false);
    await expect(h.service.isIssuanceAllowed('')).resolves.toBe(false);
  });

  it('matches a verified host regardless of case or trailing dot', async () => {
    const h = harness({ domains: [makeDomain({ status: 'ACTIVE' })] });
    await expect(h.service.isIssuanceAllowed('MyApp.com.')).resolves.toBe(true);
  });

  it.each([
    ['the feature flag is off', { CUSTOM_DOMAINS_ENABLED: false }],
    ['issuance is switched off', { TLS_CHECK_ENABLED: false }],
  ])('refuses everything when %s', async (_label, config) => {
    const h = harness({ domains: [makeDomain({ status: 'ACTIVE' })], config });
    await expect(h.service.isIssuanceAllowed('myapp.com')).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('update', () => {
  it('refuses to make a domain primary before it is serving', async () => {
    const h = harness({ domains: [makeDomain({ status: 'VERIFIED' })] });
    await expect(
      h.service.update(PROJECT_ID, OWNER_ID, 'domain-1', { isPrimary: true }),
    ).rejects.toThrow(ValidationError);
  });

  it('moves the primary flag off the previous holder', async () => {
    const old = makeDomain({ id: 'domain-1', hostname: 'old.com', status: 'ACTIVE', isPrimary: true });
    const next = makeDomain({ id: 'domain-2', hostname: 'new.com', status: 'ACTIVE' });
    const h = harness({ domains: [old, next] });

    await h.service.update(PROJECT_ID, OWNER_ID, 'domain-2', { isPrimary: true });

    expect(h.store.get('domain-1')!.isPrimary).toBe(false);
    expect(h.store.get('domain-2')!.isPrimary).toBe(true);
  });

  it('toggles the redirect policy independently of primary status', async () => {
    const h = harness({ domains: [makeDomain({ status: 'ACTIVE' })] });
    const view = await h.service.update(PROJECT_ID, OWNER_ID, 'domain-1', {
      redirectToPrimary: false,
    });
    expect(view.redirectToPrimary).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DNS instructions
// ---------------------------------------------------------------------------

describe('DNS instructions', () => {
  it('tells an apex domain to use an A record', async () => {
    const h = harness({ domains: [makeDomain({ hostname: 'myapp.com' })] });
    const [view] = await h.service.list(PROJECT_ID, OWNER_ID);
    expect(view.isApex).toBe(true);
    expect(view.dnsRecords.map((r) => r.kind)).toEqual(['TXT', 'A']);
    expect(view.dnsRecords[1].value).toBe(CONFIG.PLATFORM_INGRESS_IP);
  });

  it('tells a sub-domain to use a CNAME', async () => {
    const h = harness({ domains: [makeDomain({ hostname: 'www.myapp.com' })] });
    const [view] = await h.service.list(PROJECT_ID, OWNER_ID);
    expect(view.isApex).toBe(false);
    expect(view.dnsRecords.map((r) => r.kind)).toEqual(['TXT', 'CNAME']);
    expect(view.dnsRecords[1].value).toBe(CONFIG.CUSTOM_DOMAIN_CNAME_TARGET);
  });

  it('treats a two-label public suffix as an apex', async () => {
    const h = harness({ domains: [makeDomain({ hostname: 'myapp.co.uk' })] });
    const [view] = await h.service.list(PROJECT_ID, OWNER_ID);
    expect(view.isApex).toBe(true);
  });
});
