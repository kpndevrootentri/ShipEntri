import type { DomainStatus } from '@prisma/client';

/**
 * Status sets for the custom-domain lifecycle.
 *
 * These live in their own dependency-free module rather than beside the
 * repository because `src/proxy.ts` needs `isRoutableStatus` on the request
 * path: importing them from the repository would drag Prisma into the
 * middleware bundle just to read three string literals.
 */

/**
 * Statuses reached only by proving ownership over DNS.
 *
 * Gates two things that must never disagree: whether the edge may order a
 * certificate, and whether the proxy will route the host at all.
 */
export const ISSUABLE_STATUSES: DomainStatus[] = ['VERIFIED', 'PROVISIONING', 'ACTIVE'];

/** Statuses from which an observed HTTPS request promotes a domain to ACTIVE. */
export const PROMOTABLE_STATUSES: DomainStatus[] = ['VERIFIED', 'PROVISIONING'];

/** Statuses the background sweep keeps polling. */
export const RECHECKABLE_STATUSES: DomainStatus[] = [
  'PENDING_DNS',
  'VERIFYING',
  'VERIFIED',
  'PROVISIONING',
  'FAILED',
];

/**
 * Whether the proxy should serve this host.
 *
 * NOTE: this check is what actually makes the five-strikes teardown effective.
 * A torn-down domain flips to FAILED, but its certificate stays valid in the
 * edge's store for weeks — the edge only consults the ask endpoint when it needs
 * to *obtain* a certificate, not to serve one it already holds. Without this
 * gate a domain we decided to stop serving keeps being served until the cert
 * renews.
 */
export function isRoutableStatus(status: DomainStatus): boolean {
  return ISSUABLE_STATUSES.includes(status);
}
