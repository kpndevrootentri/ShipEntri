import { parseSafeRepoUrl, hostMatchesSource, repoFullNameFromUrl } from '@/lib/git-url';
import { ValidationError } from '@/lib/errors';

describe('parseSafeRepoUrl', () => {
  it('accepts a normal github https clone URL', () => {
    const { host } = parseSafeRepoUrl('https://github.com/owner/repo.git');
    expect(host).toBe('github.com');
  });

  it('accepts a gitlab https URL and a www. host', () => {
    expect(parseSafeRepoUrl('https://gitlab.com/group/repo').host).toBe('gitlab.com');
    expect(parseSafeRepoUrl('https://www.github.com/owner/repo').host).toBe('github.com');
  });

  it.each([
    ['ext:: RCE transport', 'ext::sh -c "touch /tmp/pwned"'],
    ['file:// local read', 'file:///etc/passwd'],
    ['ssh transport', 'ssh://git@github.com/owner/repo.git'],
    ['git transport', 'git://github.com/owner/repo.git'],
    ['plain http', 'http://github.com/owner/repo.git'],
    ['arbitrary host (token exfil)', 'https://evil.example.com/owner/repo.git'],
    ['internal SSRF host', 'https://169.254.169.254/latest/meta-data'],
    ['embedded credentials', 'https://user:pass@github.com/owner/repo.git'],
    ['host root, no repo', 'https://github.com/'],
    ['owner only, no repo', 'https://github.com/owner'],
    ['not a url', 'not-a-url'],
  ])('rejects %s', (_label, input) => {
    expect(() => parseSafeRepoUrl(input)).toThrow(ValidationError);
  });
});

describe('repoFullNameFromUrl', () => {
  it('returns lowercased owner/repo without .git', () => {
    expect(repoFullNameFromUrl('https://github.com/Owner/Repo.git')).toBe('owner/repo');
    expect(repoFullNameFromUrl('https://www.github.com/Owner/Repo')).toBe('owner/repo');
  });

  it('throws on an unsafe URL', () => {
    expect(() => repoFullNameFromUrl('https://evil.example.com/o/r')).toThrow(ValidationError);
  });
});

describe('hostMatchesSource', () => {
  it('matches host to declared source', () => {
    expect(hostMatchesSource('github.com', 'GITHUB')).toBe(true);
    expect(hostMatchesSource('gitlab.com', 'GITLAB')).toBe(true);
    expect(hostMatchesSource('github.com', 'GITLAB')).toBe(false);
    expect(hostMatchesSource('gitlab.com', 'GITHUB')).toBe(false);
  });
});
