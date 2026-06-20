/**
 * GitHub webhook helpers — signature verification and push-event parsing.
 *
 * The webhook ingress endpoint is public/unauthenticated; its only defence is the
 * HMAC-SHA256 signature GitHub sends in the `X-Hub-Signature-256` header, computed
 * over the *raw* request body using the per-project shared secret.
 */
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Constant-time verification of GitHub's `X-Hub-Signature-256` header.
 *
 * @param rawBody  the exact raw request body bytes (string) GitHub signed
 * @param signatureHeader  value of the `X-Hub-Signature-256` header, e.g. "sha256=abc…"
 * @param secret   the project's webhook secret (plaintext)
 */
export function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;

  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  const a = Buffer.from(signatureHeader, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on length mismatch — guard first (lengths aren't secret).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface PushPayload {
  ref?: unknown;
  repository?: { full_name?: unknown };
}

/**
 * Extracts the branch name from a push payload's `ref` (`refs/heads/<branch>`).
 * Returns null for tag pushes, deletes of non-branch refs, or malformed payloads.
 */
export function parsePushRef(payload: PushPayload): string | null {
  const ref = payload?.ref;
  if (typeof ref !== 'string') return null;
  const prefix = 'refs/heads/';
  if (!ref.startsWith(prefix)) return null;
  const branch = ref.slice(prefix.length);
  return branch.length > 0 ? branch : null;
}

/** Extracts the lowercased "owner/repo" from a push payload, or null if absent. */
export function parsePushRepoFullName(payload: PushPayload): string | null {
  const fullName = payload?.repository?.full_name;
  return typeof fullName === 'string' && fullName.length > 0 ? fullName.toLowerCase() : null;
}
