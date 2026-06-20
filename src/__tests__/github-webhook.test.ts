import { createHmac } from 'crypto';
import { verifySignature, parsePushRef, parsePushRepoFullName } from '@/lib/github-webhook';

const SECRET = 'super-secret-value';
const sign = (body: string, secret = SECRET): string =>
  'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

describe('verifySignature', () => {
  const body = JSON.stringify({ ref: 'refs/heads/main', hello: 'world' });

  it('accepts a correctly signed body', () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = sign(body);
    expect(verifySignature(body + ' ', sig, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(verifySignature(body, sign(body, 'other-secret'), SECRET)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifySignature(body, null, SECRET)).toBe(false);
  });

  it('rejects a malformed / wrong-length signature without throwing', () => {
    expect(verifySignature(body, 'sha256=deadbeef', SECRET)).toBe(false);
    expect(verifySignature(body, 'garbage', SECRET)).toBe(false);
  });
});

describe('parsePushRef', () => {
  it('extracts the branch from a branch push', () => {
    expect(parsePushRef({ ref: 'refs/heads/main' })).toBe('main');
    expect(parsePushRef({ ref: 'refs/heads/feature/x-y' })).toBe('feature/x-y');
  });

  it('returns null for tag pushes and malformed refs', () => {
    expect(parsePushRef({ ref: 'refs/tags/v1.0.0' })).toBeNull();
    expect(parsePushRef({ ref: 'refs/heads/' })).toBeNull();
    expect(parsePushRef({})).toBeNull();
    expect(parsePushRef({ ref: 123 as unknown as string })).toBeNull();
  });
});

describe('parsePushRepoFullName', () => {
  it('extracts and lowercases the repository full name', () => {
    expect(parsePushRepoFullName({ repository: { full_name: 'Owner/Repo' } })).toBe('owner/repo');
  });

  it('returns null when absent', () => {
    expect(parsePushRepoFullName({})).toBeNull();
    expect(parsePushRepoFullName({ repository: {} })).toBeNull();
  });
});
