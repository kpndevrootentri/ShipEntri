import {
  normalizeHostname,
  assertHostnameAllowed,
  isUnderDomain,
  HostnameError,
} from '@/validators/domain.validator';

describe('normalizeHostname', () => {
  it.each([
    ['plain hostname', 'myapp.com', 'myapp.com'],
    ['uppercase', 'MyApp.COM', 'myapp.com'],
    ['surrounding whitespace', '  myapp.com  ', 'myapp.com'],
    ['trailing dot (FQDN form)', 'myapp.com.', 'myapp.com'],
    ['pasted https URL', 'https://myapp.com/pricing?x=1', 'myapp.com'],
    ['pasted URL with credentials', 'https://user:pw@myapp.com/', 'myapp.com'],
    ['subdomain', 'app.myapp.co.uk', 'app.myapp.co.uk'],
    ['hyphenated label', 'my-cool-app.dev', 'my-cool-app.dev'],
  ])('normalises %s', (_label, input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
  });

  it('converts an internationalised domain to punycode', () => {
    // The Host header always arrives as ASCII, so the stored form must be too —
    // otherwise the proxy lookup could never match.
    expect(normalizeHostname('bücher.de')).toBe('xn--bcher-kva.de');
  });

  it.each([
    ['empty input', ''],
    ['single label', 'localhost'],
    ['bare TLD', 'com'],
    ['wildcard', '*.myapp.com'],
    ['IPv4 literal', '203.0.113.10'],
    ['host:port', 'myapp.com:8080'],
    ['IPv6 literal', '2001:db8::1'],
    ['leading hyphen in label', '-bad.com'],
    ['trailing hyphen in label', 'bad-.com'],
    ['empty label', 'my..app.com'],
    ['underscore in label', 'my_app.com'],
    ['numeric TLD', 'myapp.123'],
    ['label over 63 chars', `${'a'.repeat(64)}.com`],
    ['name over 253 chars', `${`${'a'.repeat(60)}.`.repeat(5)}com`],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeHostname(input)).toThrow(HostnameError);
  });

  it.each(['app.local', 'thing.internal', 'foo.test', 'x.invalid', 'y.onion'])(
    'rejects %s — a public certificate can never be issued for it',
    (input) => {
      expect(() => normalizeHostname(input)).toThrow(HostnameError);
    },
  );
});

describe('isUnderDomain', () => {
  it('matches the domain itself and any sub-domain', () => {
    expect(isUnderDomain('app.en3.wtf', 'app.en3.wtf')).toBe(true);
    expect(isUnderDomain('foo.app.en3.wtf', 'app.en3.wtf')).toBe(true);
    expect(isUnderDomain('a.b.app.en3.wtf', 'app.en3.wtf')).toBe(true);
  });

  it('does not match a domain that merely ends in the same string', () => {
    // "notapp.en3.wtf" endsWith "app.en3.wtf" as a raw string — the dot
    // boundary is what stops that from being treated as a sub-domain.
    expect(isUnderDomain('notapp.en3.wtf', 'app.en3.wtf')).toBe(false);
    expect(isUnderDomain('en3.wtf', 'app.en3.wtf')).toBe(false);
  });
});

describe('assertHostnameAllowed', () => {
  const opts = { baseDomain: 'app.en3.wtf', appUrl: 'https://app.en3.wtf' };

  it('allows an unrelated domain the user owns', () => {
    expect(() => assertHostnameAllowed('myapp.com', opts)).not.toThrow();
  });

  it.each(['app.en3.wtf', 'someone.app.en3.wtf', 'deep.nested.app.en3.wtf'])(
    'rejects %s — claiming a platform host would shadow the dashboard or another tenant',
    (host) => {
      expect(() => assertHostnameAllowed(host, opts)).toThrow(HostnameError);
    },
  );

  it('rejects a hostname on the operator denylist, including its sub-domains', () => {
    const withDenylist = { ...opts, denylist: 'internal.corp.example, blocked.com' };
    expect(() => assertHostnameAllowed('blocked.com', withDenylist)).toThrow(HostnameError);
    expect(() => assertHostnameAllowed('a.blocked.com', withDenylist)).toThrow(HostnameError);
    expect(() => assertHostnameAllowed('notblocked.com', withDenylist)).not.toThrow();
  });

  it('tolerates a malformed APP_URL rather than failing the request', () => {
    expect(() =>
      assertHostnameAllowed('myapp.com', { baseDomain: 'app.en3.wtf', appUrl: 'not a url' }),
    ).not.toThrow();
  });
});
