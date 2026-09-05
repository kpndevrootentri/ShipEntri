import { z } from 'zod';
import { domainToASCII } from 'url';

/**
 * Hostname rules for custom domains.
 *
 * Everything here is *syntactic* and config-free so it can be unit-tested and
 * reused on both sides of the wire. Policy that needs runtime config (the
 * platform's own BASE_DOMAIN, the operator denylist) lives in
 * `assertHostnameAllowed` below, which the service calls.
 */

/** A single DNS label: 1–63 chars, alphanumeric, inner hyphens only. */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Hostnames nobody may ever claim, regardless of operator config. */
const ALWAYS_RESERVED = new Set([
  'localhost',
  'localhost.localdomain',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/**
 * TLDs that can never resolve publicly, so Let's Encrypt can never validate
 * them. Accepting one would strand the domain in PROVISIONING forever.
 */
const NON_PUBLIC_TLDS = new Set(['local', 'localhost', 'internal', 'invalid', 'test', 'example', 'onion', 'home', 'lan', 'corp']);

export class HostnameError extends Error {}

function isIpLiteral(host: string): boolean {
  // IPv4 dotted quad, or anything containing ':' (IPv6 / host:port).
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Normalises user input to the canonical form stored in `CustomDomain.hostname`
 * and compared against the incoming `Host` header: lowercase punycode ASCII,
 * no scheme, no port, no path, no trailing dot.
 *
 * Throws `HostnameError` with a user-facing message on anything invalid.
 */
export function normalizeHostname(input: string): string {
  let host = input.trim().toLowerCase();

  if (!host) throw new HostnameError('Enter a domain');

  // Tolerate a pasted URL — strip scheme, then path/query/fragment.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split(/[/?#]/)[0];
  // Strip credentials if a full URL was pasted.
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1);
  // Strip a trailing dot (fully-qualified form).
  host = host.replace(/\.$/, '');

  if (!host) throw new HostnameError('Enter a domain');

  if (host.startsWith('*.') || host.includes('*')) {
    throw new HostnameError('Wildcard domains are not supported yet — add each hostname individually');
  }

  if (isIpLiteral(host)) {
    throw new HostnameError('Enter a domain name, not an IP address or a host:port');
  }

  // IDN → punycode. domainToASCII returns '' for input it cannot convert.
  const ascii = domainToASCII(host);
  if (!ascii) {
    throw new HostnameError('That does not look like a valid domain');
  }
  host = ascii;

  if (host.length > 253) {
    throw new HostnameError('Domain is too long (max 253 characters)');
  }

  const labels = host.split('.');
  if (labels.length < 2) {
    throw new HostnameError('Enter a full domain, for example "myapp.com"');
  }
  for (const label of labels) {
    if (!LABEL.test(label)) {
      throw new HostnameError(`"${label}" is not a valid part of a domain name`);
    }
  }

  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) {
    throw new HostnameError('A domain cannot end in a number');
  }
  if (NON_PUBLIC_TLDS.has(tld)) {
    throw new HostnameError(`".${tld}" domains cannot get a public certificate`);
  }
  if (ALWAYS_RESERVED.has(host)) {
    throw new HostnameError('That hostname is reserved');
  }

  return host;
}

/** True when `host` is `base` itself or any sub-domain of it. */
export function isUnderDomain(host: string, base: string): boolean {
  const b = base.trim().toLowerCase().replace(/\.$/, '');
  if (!b) return false;
  return host === b || host.endsWith(`.${b}`);
}

/**
 * Policy check that needs runtime config. Rejects the platform's own domains —
 * claiming `app.en3.wtf` or any `*.app.en3.wtf` would let a tenant shadow the
 * dashboard or another tenant's subdomain — plus the operator denylist.
 */
export function assertHostnameAllowed(
  host: string,
  opts: { baseDomain: string; appUrl?: string; denylist?: string },
): void {
  if (isUnderDomain(host, opts.baseDomain)) {
    throw new HostnameError(
      `${host} is already served by DropDeploy — custom domains are for domains you own elsewhere`,
    );
  }

  if (opts.appUrl) {
    try {
      const appHost = new URL(opts.appUrl).hostname.toLowerCase();
      if (host === appHost) {
        throw new HostnameError('That hostname is reserved');
      }
    } catch {
      // Malformed APP_URL — nothing to compare against.
    }
  }

  const denied = (opts.denylist ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  for (const entry of denied) {
    if (host === entry || isUnderDomain(host, entry)) {
      throw new HostnameError('That hostname is not available');
    }
  }
}

/** POST body — add a domain to a project. */
export const addDomainSchema = z.object({
  hostname: z.string().min(1, 'Enter a domain').max(300),
});

/** PATCH body — at least one field; both are independent toggles. */
export const updateDomainSchema = z
  .object({
    isPrimary: z.literal(true).optional(),
    redirectToPrimary: z.boolean().optional(),
  })
  .refine(
    (d) => d.isPrimary !== undefined || d.redirectToPrimary !== undefined,
    'Nothing to update',
  );

export type AddDomainDto = z.infer<typeof addDomainSchema>;
export type UpdateDomainDto = z.infer<typeof updateDomainSchema>;
