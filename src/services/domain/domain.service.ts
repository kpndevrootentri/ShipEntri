import { randomBytes } from 'crypto';
import type { CustomDomain, DomainStatus } from '@prisma/client';
import {
  domainRepository,
  ISSUABLE_STATUSES,
  type IDomainRepository,
} from '@/repositories/domain.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { auditLogRepository, type IAuditLogRepository } from '@/repositories/audit-log.repository';
import { dnsResolver, type IDnsResolver } from '@/lib/dns-resolver';
import { invalidateHost, promoteHostToActive } from '@/lib/domain-resolver';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import {
  normalizeHostname,
  assertHostnameAllowed,
  HostnameError,
  type AddDomainDto,
  type UpdateDomainDto,
} from '@/validators/domain.validator';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
  QuotaExceededError,
} from '@/lib/errors';

const log = createLogger('domain-service');

/** Label prefixed to the hostname for the ownership TXT record. */
export const VERIFY_LABEL = '_dropdeploy-verify';
/** Prefix of the TXT record's value. */
export const VERIFY_PREFIX = 'dropdeploy-verify=';

/**
 * Consecutive failed re-checks before an ACTIVE domain is torn down.
 *
 * This is the dangling-DNS defence: if an owner removes the TXT record or lets
 * the domain lapse, we stop serving it rather than leaving a live hostname
 * pointed at a tenant's content for whoever registers it next. It is
 * deliberately not 1 — a single DNS blip must not take a customer's site down.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

/** Certificate authority the platform expects to be allowed by any CAA record. */
const CA_IDENTIFIER = 'letsencrypt.org';

/**
 * Public suffixes that are two labels long. Used only to phrase the DNS advice
 * ("apex needs an A record") — never for a security decision, so a miss here
 * degrades to slightly wrong copy, not to a wrong authorisation.
 */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk',
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in',
  'com.au', 'net.au', 'org.au', 'edu.au',
  'co.nz', 'co.za', 'co.jp', 'com.br', 'com.mx', 'com.sg', 'com.tr',
]);

export type DnsRecordKind = 'A' | 'CNAME' | 'TXT';

export interface DnsInstruction {
  kind: DnsRecordKind;
  /** The name to enter at the registrar, relative to the zone where possible. */
  name: string;
  value: string;
  note?: string;
}

/** A domain plus everything the settings UI needs to render it. */
export interface DomainView {
  id: string;
  hostname: string;
  status: DomainStatus;
  isPrimary: boolean;
  redirectToPrimary: boolean;
  isApex: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  dnsRecords: DnsInstruction[];
}

/** Outcome of one DNS verification pass. */
export interface CheckResult {
  status: DomainStatus;
  ownershipVerified: boolean;
  routingVerified: boolean;
  message: string | null;
}

export interface IDomainService {
  list(projectId: string, ownerId: string): Promise<DomainView[]>;
  add(projectId: string, ownerId: string, dto: AddDomainDto): Promise<DomainView>;
  verify(projectId: string, ownerId: string, domainId: string): Promise<DomainView>;
  update(projectId: string, ownerId: string, domainId: string, dto: UpdateDomainDto): Promise<DomainView>;
  remove(projectId: string, ownerId: string, domainId: string): Promise<void>;
  isIssuanceAllowed(hostname: string): Promise<boolean>;
  markCertObserved(hostname: string): Promise<void>;
  runCheck(domain: CustomDomain): Promise<CheckResult>;
}

export class DomainService implements IDomainService {
  constructor(
    private readonly domainRepo: IDomainRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly userRepo: IUserRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly dns: IDnsResolver,
    private readonly cfg: typeof getConfig = getConfig,
  ) {}

  // ── Queries ──────────────────────────────────────────────────────────────

  async list(projectId: string, ownerId: string): Promise<DomainView[]> {
    await this.assertOwner(projectId, ownerId);
    const domains = await this.domainRepo.listByProject(projectId);
    return domains.map((d) => this.toView(d));
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  async add(projectId: string, ownerId: string, dto: AddDomainDto): Promise<DomainView> {
    this.assertFeatureEnabled();
    await this.assertOwner(projectId, ownerId);

    const config = this.cfg();
    let hostname: string;
    try {
      hostname = normalizeHostname(dto.hostname);
      assertHostnameAllowed(hostname, {
        baseDomain: config.BASE_DOMAIN,
        appUrl: config.APP_URL ?? config.NEXT_PUBLIC_APP_URL,
        denylist: config.CUSTOM_DOMAIN_DENYLIST,
      });
    } catch (err) {
      if (err instanceof HostnameError) throw new ValidationError(err.message);
      throw err;
    }

    await this.assertQuota(ownerId);

    // A pre-check gives a clear message; the unique index below is what
    // actually prevents two projects racing for the same hostname.
    const existing = await this.domainRepo.findByHostname(hostname);
    if (existing) {
      throw new ConflictError(
        existing.projectId === projectId
          ? 'That domain is already added to this project'
          : 'That domain is already claimed by another project',
      );
    }

    let created: CustomDomain;
    try {
      created = await this.domainRepo.create({
        hostname,
        projectId,
        verificationToken: randomBytes(24).toString('base64url'),
      });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new ConflictError('That domain is already claimed by another project');
      }
      throw err;
    }

    await invalidateHost(hostname);
    await this.audit('domain.add', hostname, ownerId, projectId);
    log.info('Custom domain added', { hostname, projectId });

    return this.toView(created);
  }

  async verify(projectId: string, ownerId: string, domainId: string): Promise<DomainView> {
    this.assertFeatureEnabled();
    await this.assertOwner(projectId, ownerId);
    const domain = await this.findOwnedDomain(projectId, domainId);

    await this.runCheck(domain);

    const refreshed = await this.domainRepo.findById(domainId);
    if (!refreshed) throw new NotFoundError('Domain');
    return this.toView(refreshed);
  }

  async update(
    projectId: string,
    ownerId: string,
    domainId: string,
    dto: UpdateDomainDto,
  ): Promise<DomainView> {
    this.assertFeatureEnabled();
    await this.assertOwner(projectId, ownerId);
    const domain = await this.findOwnedDomain(projectId, domainId);

    let updated = domain;

    if (dto.redirectToPrimary !== undefined) {
      updated = await this.domainRepo.update(domainId, {
        redirectToPrimary: dto.redirectToPrimary,
      });
    }

    if (dto.isPrimary) {
      if (domain.status !== 'ACTIVE') {
        throw new ValidationError('Only an active domain can be made primary');
      }
      updated = await this.domainRepo.setPrimary(projectId, domainId);
      await this.audit('domain.set_primary', domain.hostname, ownerId, projectId);
    }

    // A primary change alters how *every* domain on the project routes, so the
    // whole project's host set has to be evicted, not just this one.
    await this.invalidateProject(projectId);

    return this.toView(updated);
  }

  async remove(projectId: string, ownerId: string, domainId: string): Promise<void> {
    await this.assertOwner(projectId, ownerId);
    const domain = await this.findOwnedDomain(projectId, domainId);

    await this.domainRepo.delete(domainId);
    await this.invalidateProject(projectId, domain.hostname);
    await this.audit('domain.remove', domain.hostname, ownerId, projectId);
    log.info('Custom domain removed', { hostname: domain.hostname, projectId });
  }

  // ── Edge integration ─────────────────────────────────────────────────────

  /**
   * The Caddy "ask" decision: may the edge order a certificate for this host?
   *
   * This is a security control, not a convenience. A `true` for an arbitrary
   * hostname lets anyone point a domain at the platform IP and make us order
   * certificates for it — burning the Let's Encrypt per-domain quota for every
   * real tenant (a denial of service) and inviting domain fronting. So it is
   * deny-by-default: the feature flag, the issuance flag, and a status that
   * only DNS-proven ownership can reach must all hold.
   */
  async isIssuanceAllowed(hostname: string): Promise<boolean> {
    const config = this.cfg();
    if (!config.CUSTOM_DOMAINS_ENABLED || !config.TLS_CHECK_ENABLED) return false;

    let host: string;
    try {
      host = normalizeHostname(hostname);
    } catch {
      return false;
    }

    const domain = await this.domainRepo.findByHostname(host);
    if (!domain) return false;
    return ISSUABLE_STATUSES.includes(domain.status);
  }

  /**
   * Records that the edge has actually served TLS for this hostname. Delegates
   * to the resolver, which owns the promotion so the proxy hot path can call it
   * without loading this service.
   */
  async markCertObserved(hostname: string): Promise<void> {
    await promoteHostToActive(hostname);
  }

  // ── Verification ─────────────────────────────────────────────────────────

  /**
   * One DNS verification pass. Shared by the manual "Verify" button and the
   * background re-check job, so both drive the state machine identically.
   *
   * Two independent signals:
   *   1. the TXT token proves the user controls the domain  → ownership
   *   2. an A/CNAME pointing at us proves traffic will arrive → routing
   *
   * Ownership gates issuance. Routing only decides whether the domain can
   * actually serve yet, and is reported back as guidance.
   */
  async runCheck(domain: CustomDomain): Promise<CheckResult> {
    const config = this.cfg();
    const now = new Date();

    let ownershipVerified = false;
    let routingVerified = false;
    let message: string | null = null;
    let status: DomainStatus = domain.status;

    try {
      // 1 — ownership
      const txts = await this.dns.resolveTxt(`${VERIFY_LABEL}.${domain.hostname}`);
      const expected = `${VERIFY_PREFIX}${domain.verificationToken}`;
      ownershipVerified = txts.some((t) => t.trim() === expected);

      if (!ownershipVerified) {
        message =
          txts.length === 0
            ? `No TXT record found at ${VERIFY_LABEL}.${domain.hostname}. DNS changes can take a few minutes to propagate.`
            : `A TXT record exists at ${VERIFY_LABEL}.${domain.hostname} but its value does not match. Check for a stale record from an earlier attempt.`;
      } else {
        // 2 — routing
        routingVerified = await this.checkRouting(domain.hostname, config);
        if (!routingVerified) {
          message = this.isApex(domain.hostname)
            ? `Ownership confirmed. Now point ${domain.hostname} at us with an A record${config.PLATFORM_INGRESS_IP ? ` (${config.PLATFORM_INGRESS_IP})` : ''}.`
            : `Ownership confirmed. Now point ${domain.hostname} at us with a CNAME${config.CUSTOM_DOMAIN_CNAME_TARGET ? ` to ${config.CUSTOM_DOMAIN_CNAME_TARGET}` : ''}.`;
        }
      }

      // 3 — CAA, but only once the domain is otherwise ready. A CAA record that
      // excludes our CA is the difference between "waiting for a certificate"
      // and "a certificate can never be issued", and it is the single most
      // opaque failure a user can hit, so name it explicitly.
      if (ownershipVerified && routingVerified) {
        const caaBlock = await this.findBlockingCaa(domain.hostname);
        if (caaBlock) {
          status = 'FAILED';
          message = `A CAA record on ${caaBlock} does not allow ${CA_IDENTIFIER} to issue certificates. Add "0 issue \\"${CA_IDENTIFIER}\\"" or remove the CAA record.`;
          await this.persistCheck(domain, { status, message, now, reset: false });
          return { status, ownershipVerified, routingVerified, message };
        }
      }
    } catch (err) {
      // A resolver failure is *our* problem, not the user's misconfiguration —
      // never let it count towards the revocation counter or flip a live
      // domain to FAILED.
      const reason = err instanceof Error ? err.message : String(err);
      log.warn('DNS check failed', { hostname: domain.hostname, reason });
      await this.domainRepo.update(domain.id, { lastCheckedAt: now });
      return {
        status: domain.status,
        ownershipVerified: false,
        routingVerified: false,
        message: 'Could not reach DNS just now — we will try again shortly.',
      };
    }

    if (ownershipVerified) {
      // An already-serving domain stays ACTIVE; a newly proven one moves to
      // PROVISIONING once traffic can reach us, which is what unlocks issuance.
      status = domain.status === 'ACTIVE' ? 'ACTIVE' : routingVerified ? 'PROVISIONING' : 'VERIFIED';
      await this.persistCheck(domain, { status, message, now, reset: true });
    } else {
      status = this.demote(domain);
      await this.persistCheck(domain, { status, message, now, reset: false });
    }

    return { status, ownershipVerified, routingVerified, message };
  }

  /**
   * Where a domain goes when its ownership record is missing.
   *
   * A domain that has never verified simply stays PENDING_DNS. One that *was*
   * live is given `MAX_CONSECUTIVE_FAILURES` grace passes before being pulled
   * down, so transient DNS trouble does not take a customer's site offline,
   * while a genuinely abandoned domain still stops being served.
   */
  private demote(domain: CustomDomain): DomainStatus {
    const wasProven = domain.verifiedAt !== null;
    if (!wasProven) return 'PENDING_DNS';
    return domain.failureCount + 1 >= MAX_CONSECUTIVE_FAILURES ? 'FAILED' : domain.status;
  }

  private async persistCheck(
    domain: CustomDomain,
    opts: { status: DomainStatus; message: string | null; now: Date; reset: boolean },
  ): Promise<void> {
    await this.domainRepo.update(domain.id, {
      status: opts.status,
      lastCheckedAt: opts.now,
      lastError: opts.message,
      failureCount: opts.reset ? 0 : domain.failureCount + 1,
      ...(opts.reset && domain.verifiedAt === null ? { verifiedAt: opts.now } : {}),
    });
    await this.invalidateProject(domain.projectId, domain.hostname);
  }

  /** True when the hostname's A/CNAME actually points at this platform. */
  private async checkRouting(hostname: string, config: ReturnType<typeof getConfig>): Promise<boolean> {
    const cnameTarget = config.CUSTOM_DOMAIN_CNAME_TARGET?.toLowerCase().replace(/\.$/, '');
    const ingressIp = config.PLATFORM_INGRESS_IP;

    // With neither target configured there is nothing to compare against, so
    // routing cannot be asserted. Report "not verified" rather than pretending.
    if (!cnameTarget && !ingressIp) return false;

    if (cnameTarget) {
      const cnames = await this.dns.resolveCname(hostname);
      if (cnames.some((c) => c === cnameTarget)) return true;
    }

    if (ingressIp) {
      // Resolving A also follows any CNAME chain, so this covers users who
      // CNAME'd to something that ultimately lands on our ingress.
      const addresses = await this.dns.resolveA(hostname);
      if (addresses.includes(ingressIp)) return true;
    }

    return false;
  }

  /**
   * Walks up the domain looking for the closest CAA record set. Returns the
   * name carrying a record that excludes our CA, or null if issuance is fine.
   * Per RFC 8659 only the *closest* record set counts, so the walk stops at the
   * first name that has any CAA at all.
   */
  private async findBlockingCaa(hostname: string): Promise<string | null> {
    const labels = hostname.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const name = labels.slice(i).join('.');
      const records = await this.dns.resolveCaa(name);
      const issue = records.map((r) => r.issue).filter((v): v is string => typeof v === 'string');
      if (issue.length === 0) continue; // no CAA at this level — keep climbing

      const allowed = issue.some((v) => {
        const authority = v.trim().split(';')[0].trim().toLowerCase();
        return authority === CA_IDENTIFIER || authority === ';';
      });
      return allowed ? null : name;
    }
    return null;
  }

  // ── Presentation ─────────────────────────────────────────────────────────

  /**
   * Apex detection for DNS advice only. Two labels is an apex; three labels
   * ending in a known two-label public suffix (`co.uk`) is too.
   */
  private isApex(hostname: string): boolean {
    const labels = hostname.split('.');
    if (labels.length === 2) return true;
    if (labels.length === 3 && TWO_LABEL_SUFFIXES.has(labels.slice(1).join('.'))) return true;
    return false;
  }

  private dnsRecords(domain: CustomDomain): DnsInstruction[] {
    const config = this.cfg();
    const apex = this.isApex(domain.hostname);
    const records: DnsInstruction[] = [
      {
        kind: 'TXT',
        name: `${VERIFY_LABEL}.${domain.hostname}`,
        value: `${VERIFY_PREFIX}${domain.verificationToken}`,
        note: 'Proves you own this domain. Required before a certificate is issued.',
      },
    ];

    if (apex) {
      records.push({
        kind: 'A',
        name: domain.hostname,
        value: config.PLATFORM_INGRESS_IP ?? 'contact your administrator',
        note: 'Root domains usually cannot use CNAME. If your DNS provider supports ALIAS or ANAME, that works too.',
      });
    } else {
      records.push({
        kind: 'CNAME',
        name: domain.hostname,
        value: config.CUSTOM_DOMAIN_CNAME_TARGET ?? config.PLATFORM_INGRESS_IP ?? 'contact your administrator',
      });
    }

    return records;
  }

  private toView(domain: CustomDomain): DomainView {
    return {
      id: domain.id,
      hostname: domain.hostname,
      status: domain.status,
      isPrimary: domain.isPrimary,
      redirectToPrimary: domain.redirectToPrimary,
      isApex: this.isApex(domain.hostname),
      verifiedAt: domain.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      lastError: domain.lastError,
      createdAt: domain.createdAt.toISOString(),
      dnsRecords: this.dnsRecords(domain),
    };
  }

  // ── Guards ───────────────────────────────────────────────────────────────

  private assertFeatureEnabled(): void {
    if (!this.cfg().CUSTOM_DOMAINS_ENABLED) {
      throw new ForbiddenError('Custom domains are not enabled on this platform');
    }
  }

  /**
   * Ownership check. Mirrors the project service: a project the caller does not
   * own is reported as *not found*, never as forbidden, so the API cannot be
   * used to enumerate other people's project ids.
   */
  private async assertOwner(projectId: string, ownerId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project || project.userId !== ownerId) {
      throw new NotFoundError('Project');
    }
  }

  /** Re-checks that the domain belongs to this project before acting on it. */
  private async findOwnedDomain(projectId: string, domainId: string): Promise<CustomDomain> {
    const domain = await this.domainRepo.findById(domainId);
    if (!domain || domain.projectId !== projectId) {
      throw new NotFoundError('Domain');
    }
    return domain;
  }

  private async assertQuota(ownerId: string): Promise<void> {
    const user = await this.userRepo.findById(ownerId);
    if (!user) throw new NotFoundError('User');

    const used = await this.domainRepo.countByUser(ownerId);
    if (used >= user.domainQuota) {
      throw new QuotaExceededError(
        user.domainQuota === 0
          ? 'Custom domains are not included in your plan'
          : `You have used all ${user.domainQuota} of your custom domains`,
      );
    }
  }

  /** Evicts every hostname on a project, plus any extra hosts passed in. */
  private async invalidateProject(projectId: string, ...extra: string[]): Promise<void> {
    const domains = await this.domainRepo.listByProject(projectId);
    await invalidateHost(...domains.map((d) => d.hostname), ...extra);
  }

  private async audit(action: string, targetKey: string, userId: string, projectId: string): Promise<void> {
    await this.auditRepo.create({ action, targetKey, userId, projectId }).catch(() => undefined);
  }
}

export const domainService = new DomainService(
  domainRepository,
  projectRepository,
  userRepository,
  auditLogRepository,
  dnsResolver,
);
