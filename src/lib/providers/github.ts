/**
 * GitHub API client — all GitHub-specific URLs, types, and fetch logic live here.
 */

export const GITHUB_OAUTH_BASE_URL   = 'https://github.com/login/oauth';
export const GITHUB_API_BASE_URL     = 'https://api.github.com';
export const GITHUB_AUTHORIZE_URL    = `${GITHUB_OAUTH_BASE_URL}/authorize`;
export const GITHUB_TOKEN_URL        = `${GITHUB_OAUTH_BASE_URL}/access_token`;
export const GITHUB_USER_URL         = `${GITHUB_API_BASE_URL}/user`;
export const GITHUB_USER_REPOS_URL   = `${GITHUB_API_BASE_URL}/user/repos`;
export const GITHUB_SEARCH_REPOS_URL = `${GITHUB_API_BASE_URL}/search/repositories`;

/** Path appended to APP_URL to form the OAuth redirect URI. */
export const GITHUB_CALLBACK_PATH = '/api/auth/github/callback';
export const githubCallbackUrl = (appUrl: string): string => `${appUrl}${GITHUB_CALLBACK_PATH}`;

const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
} as const;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

interface GHRepo {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  updated_at: string;
}

export interface RepoItem {
  id: string;
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** Exchange an OAuth authorization code for an access token. */
export async function exchangeGitHubCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<GitHubTokenResponse> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { ...GITHUB_API_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  return res.json() as Promise<GitHubTokenResponse>;
}

/** Fetch the authenticated user's GitHub profile. */
export async function fetchGitHubUser(accessToken: string): Promise<{ ok: boolean; user?: GitHubUser; status: number }> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const user = await res.json() as GitHubUser;
  return { ok: true, status: res.status, user };
}

/** List repos for the authenticated user, with optional keyword search. */
export async function fetchGitHubRepos(accessToken: string, query: string, page: number): Promise<RepoItem[]> {
  const headers = { ...GITHUB_API_HEADERS, Authorization: `Bearer ${accessToken}` };

  const url = query
    ? `${GITHUB_SEARCH_REPOS_URL}?q=${encodeURIComponent(query)}+user:@me&sort=updated&per_page=30&page=${page}`
    : `${GITHUB_USER_REPOS_URL}?type=all&sort=updated&per_page=50&page=${page}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  const data = await res.json() as { items?: GHRepo[] } | GHRepo[];
  const repos: GHRepo[] = Array.isArray(data) ? data : (data.items ?? []);

  return repos.map((r) => ({
    id: String(r.id),
    name: r.name,
    fullName: r.full_name,
    url: r.clone_url,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description ?? null,
    updatedAt: r.updated_at,
  }));
}

/**
 * Register a push webhook on a repository. Requires the `repo` OAuth scope and
 * admin rights on the repo. `fullName` is "owner/repo".
 */
export async function createGitHubHook(
  accessToken: string,
  fullName: string,
  config: { url: string; secret: string },
): Promise<{ id: number }> {
  const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${fullName}/hooks`, {
    method: 'POST',
    headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['push'],
      config: {
        url: config.url,
        content_type: 'json',
        secret: config.secret,
        insecure_ssl: '0',
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub hook creation failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { id: number };
  return { id: data.id };
}

/**
 * Delete a previously-registered webhook. A 404 is treated as success — the hook
 * is already gone (e.g. removed manually on GitHub).
 */
export async function deleteGitHubHook(
  accessToken: string,
  fullName: string,
  hookId: string,
): Promise<void> {
  const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${fullName}/hooks/${hookId}`, {
    method: 'DELETE',
    headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`GitHub hook deletion failed (${res.status}): ${text}`);
  }
}
