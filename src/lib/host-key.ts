/**
 * Canonical cache/lookup key for a `Host` header.
 *
 * The `Host` header can arrive with mixed case, a port (`myapp.com:3001` in
 * local dev) or a trailing dot (the fully-qualified form). `CustomDomain.hostname`
 * stores none of those, so every place that compares or caches by host must
 * reduce to the same form first — otherwise a lookup and its invalidation can
 * compute different keys and the eviction silently misses.
 *
 * Deliberately dependency-free: `src/proxy.ts` imports this on the hot path for
 * every request, including ones that never touch a custom domain.
 *
 * @example normalizeHostKey('MyApp.com:3001') // 'myapp.com'
 * @example normalizeHostKey('myapp.com.')     // 'myapp.com'
 */
export function normalizeHostKey(hostname: string): string {
  return hostname.toLowerCase().split(':')[0].replace(/\.$/, '');
}
