import { Resolver } from 'dns/promises';

/**
 * The DNS surface the domain service needs, as an interface so tests can stub
 * it without touching the network.
 *
 * Every method resolves to an empty array when the record does not exist —
 * "no record" is an expected state during verification, not an error.
 */
export interface IDnsResolver {
  resolveTxt(hostname: string): Promise<string[]>;
  resolveA(hostname: string): Promise<string[]>;
  resolveCname(hostname: string): Promise<string[]>;
  /** CAA records on the name or its parents — used to explain issuance failures. */
  resolveCaa(hostname: string): Promise<{ issue?: string }[]>;
}

/** DNS error codes that mean "the record simply isn't there (yet)". */
const ABSENT = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

async function absentAsEmpty<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && ABSENT.has(code)) return [];
    throw err;
  }
}

/**
 * Live DNS resolver.
 *
 * Queries public recursive resolvers rather than the host's configured ones on
 * purpose: the platform host may sit behind a split-horizon or aggressively
 * caching resolver, which would make a user's freshly-published TXT record
 * invisible for far longer than the record's own TTL.
 */
export class DnsResolver implements IDnsResolver {
  private readonly resolver: Resolver;

  constructor(servers: string[] = ['1.1.1.1', '8.8.8.8']) {
    this.resolver = new Resolver({ timeout: 5_000, tries: 2 });
    if (servers.length > 0) {
      this.resolver.setServers(servers);
    }
  }

  async resolveTxt(hostname: string): Promise<string[]> {
    // Node returns TXT as string[][] — a record may be split into chunks that
    // the spec says to concatenate.
    const chunks = await absentAsEmpty(() => this.resolver.resolveTxt(hostname));
    return chunks.map((parts) => parts.join(''));
  }

  async resolveA(hostname: string): Promise<string[]> {
    return absentAsEmpty(() => this.resolver.resolve4(hostname));
  }

  async resolveCname(hostname: string): Promise<string[]> {
    const names = await absentAsEmpty(() => this.resolver.resolveCname(hostname));
    return names.map((n) => n.toLowerCase().replace(/\.$/, ''));
  }

  async resolveCaa(hostname: string): Promise<{ issue?: string }[]> {
    return absentAsEmpty(() => this.resolver.resolveCaa(hostname));
  }
}

export const dnsResolver = new DnsResolver();
