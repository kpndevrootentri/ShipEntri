import type { DomainStatus } from '@prisma/client';
import {
  isRoutableStatus,
  ISSUABLE_STATUSES,
  PROMOTABLE_STATUSES,
  RECHECKABLE_STATUSES,
} from '@/lib/domain-status';
import { normalizeHostKey } from '@/lib/host-key';

describe('isRoutableStatus', () => {
  it.each<[DomainStatus, boolean]>([
    ['PENDING_DNS', false],
    ['VERIFYING', false],
    ['FAILED', false],
    ['VERIFIED', true],
    ['PROVISIONING', true],
    ['ACTIVE', true],
  ])('%s → %s', (status, expected) => {
    expect(isRoutableStatus(status)).toBe(expected);
  });

  it('refuses to route a FAILED domain', () => {
    // The teardown that flips a domain to FAILED is only half the defence. The
    // edge keeps a valid certificate for weeks and will keep completing the
    // handshake, because it consults the ask endpoint to *obtain* a certificate
    // and not to serve one it already holds. This check is what actually stops
    // a domain we decided to abandon from continuing to serve tenant content.
    expect(isRoutableStatus('FAILED')).toBe(false);
  });

  it('agrees exactly with the set that authorises issuance', () => {
    // Routing and issuance must never disagree: a host we would not issue for
    // is a host we must not serve.
    for (const status of ISSUABLE_STATUSES) {
      expect(isRoutableStatus(status)).toBe(true);
    }
  });

  it('promotes only from a status that has proven ownership but not yet served', () => {
    expect(PROMOTABLE_STATUSES).not.toContain('ACTIVE');
    expect(PROMOTABLE_STATUSES).not.toContain('PENDING_DNS');
    expect(PROMOTABLE_STATUSES.every((s) => ISSUABLE_STATUSES.includes(s))).toBe(true);
  });

  it('keeps re-checking every non-terminal status, including FAILED', () => {
    // FAILED must stay in the sweep, otherwise a domain can never recover once
    // the user fixes their DNS.
    expect(RECHECKABLE_STATUSES).toContain('FAILED');
    expect(RECHECKABLE_STATUSES).not.toContain('ACTIVE');
  });
});

describe('normalizeHostKey', () => {
  it.each([
    ['lowercases', 'MyApp.COM', 'myapp.com'],
    ['strips the dev port', 'myapp.com:3001', 'myapp.com'],
    ['strips a trailing dot', 'myapp.com.', 'myapp.com'],
    ['strips both', 'MyApp.com.:443', 'myapp.com'],
    ['leaves a plain host alone', 'myapp.com', 'myapp.com'],
  ])('%s', (_label, input, expected) => {
    expect(normalizeHostKey(input)).toBe(expected);
  });

  it('is idempotent, so a lookup and its invalidation compute the same key', () => {
    // The bug this guards against: caching under one form and evicting under
    // another leaves a stale route serving until the TTL expires.
    for (const input of ['MyApp.com.:3001', 'myapp.com', 'MYAPP.COM.']) {
      const once = normalizeHostKey(input);
      expect(normalizeHostKey(once)).toBe(once);
      expect(once).toBe('myapp.com');
    }
  });
});
