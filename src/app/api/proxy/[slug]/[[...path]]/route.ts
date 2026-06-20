import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as jose from 'jose';
import * as fs from 'fs';
import * as nodePath from 'path';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';
import { getConfig } from '@/lib/config';
import { projectAccessService } from '@/services/project-access';

export const dynamic = 'force-dynamic';

function getMimeType(filePath: string): string {
  const ext = nodePath.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',  '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',  '.woff2': 'font/woff2',
    '.ttf':  'font/ttf',
    '.map':  'application/json',
    '.webmanifest': 'application/manifest+json',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Rewrites absolute-path asset references in HTML so they resolve through the
 * in-app proxy instead of hitting the Next.js root.
 *
 * Vite and other bundlers emit paths like src="/assets/index.js" which are
 * correct when the site owns the root, but break when served under a sub-path
 * such as /api/proxy/{slug}/. This rewrites those paths at serve time so the
 * browser fetches /api/proxy/{slug}/assets/index.js.
 *
 * A <base> tag is also injected so that dynamic imports and runtime-constructed
 * relative URLs resolve against the proxy base.
 */
function rewriteHtmlPaths(html: string, slug: string): string {
  const prefix = `/api/proxy/${slug}`;
  const withBase = html.replace(/(<head\b[^>]*>)/i, `$1\n  <base href="${prefix}/">`);
  return withBase.replace(
    /(src|href|action)="(\/[^"]*?)"/g,
    (match, attr: string, path: string) => {
      if (path.startsWith('//') || path.startsWith('/api/proxy/')) return match;
      return `${attr}="${prefix}${path}"`;
    }
  );
}

async function serveStaticFile(serveDir: string, requestPath: string, slug?: string): Promise<NextResponse | null> {
  const sanitized = requestPath.replace(/^\/+/, '').replace(/\.\.\//g, '');
  const candidates = sanitized
    ? [nodePath.join(serveDir, sanitized), nodePath.join(serveDir, sanitized, 'index.html')]
    : [nodePath.join(serveDir, 'index.html')];

  const resolvedBase = nodePath.resolve(serveDir);

  for (const candidate of candidates) {
    // Reject any path that escapes the serve directory (guards against encoded traversal)
    if (!nodePath.resolve(candidate).startsWith(resolvedBase + nodePath.sep) &&
        nodePath.resolve(candidate) !== resolvedBase) continue;
    try {
      const stat = await fs.promises.stat(candidate);
      if (!stat.isFile()) continue;
      const content = await fs.promises.readFile(candidate);
      const mime = getMimeType(candidate);
      const isHashed = candidate.includes('/assets/') || candidate.includes('/_next/static/');
      const cacheControl = isHashed
        ? 'public, max-age=31536000, immutable'
        : mime.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600';

      if (slug && mime.startsWith('text/html')) {
        const rewritten = rewriteHtmlPaths(content.toString('utf-8'), slug);
        return new NextResponse(rewritten, { headers: { 'Content-Type': mime, 'Cache-Control': cacheControl } });
      }

      return new NextResponse(content, {
        headers: { 'Content-Type': mime, 'Cache-Control': cacheControl },
      });
    } catch { /* try next */ }
  }

  // SPA fallback: any unknown path → index.html (with path rewriting)
  try {
    const content = await fs.promises.readFile(nodePath.join(serveDir, 'index.html'));
    const html = slug
      ? rewriteHtmlPaths(content.toString('utf-8'), slug)
      : content.toString('utf-8');
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch { return null; }
}

function detectDevice(ua: string): 'mobile' | 'desktop' | 'bot' | 'unknown' {
  if (!ua) return 'unknown';
  const l = ua.toLowerCase();
  if (
    l.includes('bot') || l.includes('crawler') || l.includes('spider') ||
    l.includes('slurp') || l.includes('googlebot') || l.includes('facebookexternalhit')
  ) return 'bot';
  if (l.includes('mobile') || l.includes('android') || l.includes('iphone') || l.includes('ipad'))
    return 'mobile';
  return 'desktop';
}

/**
 * Hop-by-hop headers that must not be forwarded between proxies per RFC 7230.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Headers to strip from the upstream response.
 * Node.js fetch automatically decompresses gzip/br/deflate responses, so
 * forwarding content-encoding would tell the browser to decompress an already
 * decompressed body — causing a "Content Encoding Error". content-length is
 * also stale after decompression and must be dropped.
 */
const STRIP_RESPONSE = new Set(['content-encoding', 'content-length']);

/**
 * Returns a 3D isometric HTML denial page for private URLs.
 */
function denialResponse(): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>401 Access Denied</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #060608;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    overflow: hidden;
    gap: 40px;
  }

  /* Ambient orbs */
  .orb {
    position: fixed;
    border-radius: 50%;
    filter: blur(100px);
    pointer-events: none;
    z-index: 0;
  }
  .orb-1 {
    width: 560px; height: 560px;
    background: radial-gradient(circle, rgba(124,58,237,0.28), transparent 70%);
    top: -180px; left: -120px;
    animation: d1 16s ease-in-out infinite alternate;
  }
  .orb-2 {
    width: 480px; height: 480px;
    background: radial-gradient(circle, rgba(219,39,119,0.2), transparent 70%);
    bottom: -140px; right: -100px;
    animation: d2 20s ease-in-out infinite alternate;
  }
  .orb-3 {
    width: 360px; height: 360px;
    background: radial-gradient(circle, rgba(14,165,233,0.14), transparent 70%);
    top: 50%; left: 50%;
    transform: translate(-50%,-50%);
    animation: d3 13s ease-in-out infinite alternate;
  }
  @keyframes d1 { to { transform: translate(50px, 35px); } }
  @keyframes d2 { to { transform: translate(-35px, -50px); } }
  @keyframes d3 { to { transform: translate(-50%,-52%) scale(1.15); } }

  /* Digits row */
  .digits {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 8px;
  }

  /* Each digit: isometric 3D block letter via perspective tilt + layered text-shadow extrusion */
  .d {
    display: inline-block;
    font-size: 148px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -2px;
    color: #ddd6fe;
    /* Isometric camera angle */
    transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(0);
    /* Extrusion depth: 12 shadow layers stepping down-right */
    text-shadow:
      2px  3px 0 #a78bfa,
      4px  6px 0 #9333ea,
      6px  9px 0 #7c3aed,
      8px  12px 0 #6d28d9,
      10px 15px 0 #5b21b6,
      12px 18px 0 #4c1d95,
      14px 21px 0 #3b0764,
      16px 23px 0 rgba(20,5,50,0.7),
      18px 25px 0 rgba(10,2,28,0.4);
    filter: drop-shadow(0 28px 48px rgba(109,40,217,0.45));
    animation: bob 5s ease-in-out infinite;
  }

  /* Stagger each digit's bob */
  .d:nth-child(1) { animation-delay:  0s; }
  .d:nth-child(2) { animation-delay: -1.8s; }
  .d:nth-child(3) { animation-delay: -3.4s; }

  @keyframes bob {
    0%,100% { transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(0px); }
    50%      { transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(-14px); }
  }

  /* Text below */
  .label {
    position: relative;
    z-index: 1;
    text-align: center;
  }
  .label h2 {
    font-size: 21px;
    font-weight: 600;
    color: #e2e8f0;
    letter-spacing: -0.2px;
    margin-bottom: 10px;
  }
  .divider {
    width: 44px; height: 2px;
    margin: 0 auto 12px;
    border-radius: 2px;
    background: linear-gradient(90deg, #7c3aed, #db2777);
  }
  .label p {
    font-size: 14px;
    color: #475569;
    line-height: 1.6;
  }
</style>
</head>
<body>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>

  <div class="digits">
    <span class="d">4</span>
    <span class="d">0</span>
    <span class="d">1</span>
  </div>

  <div class="label">
    <h2>Access Denied</h2>
    <div class="divider"></div>
    <p>You don't have permission to view this page.</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * In-app reverse proxy for deployed containers.
 *
 * Reached via the middleware rewrite:
 *   {slug}.domain.in/some/path  →  /api/proxy/{slug}/some/path
 *
 * Flow:
 *  1. Look up the active (DEPLOYED) deployment for the slug.
 *  2. If the project is private, verify the auth cookie carries an @entri.me JWT.
 *  3. Forward the HTTP request to http://127.0.0.1:{containerPort}/{path}.
 *  4. Stream the upstream response back to the client.
 *
 * No nginx config file is written or reloaded on deployment — routing is
 * resolved dynamically from the database on each request.
 */
async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; path?: string[] }> }
): Promise<NextResponse> {
  const { slug, path = [] } = await params;

  // Resolve active deployment port from DB, including project privacy flag
  const deployment = await prisma.deployment.findFirst({
    where: { subdomain: slug, status: 'DEPLOYED' },
    select: {
      containerPort: true,
      servingMethod: true,
      projectId: true,
      project: { select: { id: true, isPrivate: true, userId: true } },
    },
  });

  if (!deployment) {
    return NextResponse.json(
      { error: `No active deployment found for "${slug}"` },
      { status: 404 }
    );
  }

  // ── Private URL gate ─────────────────────────────────────────────────────
  // Authorize the project owner, anyone on the per-project access list (specific
  // user or allowed email domain), and platform admins (CONTRIBUTOR). A logged-in
  // user who is none of these is denied — being authenticated is not enough.
  if (deployment.project.isPrivate) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    let authorized = false;

    if (token) {
      try {
        const secret = process.env.JWT_SECRET;
        if (secret) {
          const { payload } = await jose.jwtVerify(
            token,
            new TextEncoder().encode(secret),
            { algorithms: ['HS256'] }
          );
          const userId = payload.sub as string | undefined;
          const email = payload.email as string | undefined;
          const role = (payload.role as string | undefined) ?? 'USER';
          if (userId && email) {
            authorized = await projectAccessService.canView(
              { id: deployment.project.id, userId: deployment.project.userId },
              { userId, email, role },
            );
          }
        }
      } catch {
        // Expired or tampered token — treat as unauthenticated
      }
    }

    if (!authorized) {
      return denialResponse();
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const targetPath = path.length > 0 ? `/${path.join('/')}` : '/';

  if (deployment.servingMethod === 'STATIC_FILES') {
    const { STATIC_SERVE_DIR, NODE_ENV, NEXT_PUBLIC_APP_URL } = getConfig();
    const serveDir = nodePath.join(STATIC_SERVE_DIR, slug);
    // Path rewriting is only needed in localhost dev where the site is served under
    // /api/proxy/{slug}/. In production the site owns its own subdomain so absolute
    // paths (/_next/static/...) resolve correctly without any rewriting.
    const isLocalDev = NODE_ENV !== 'production' && !!NEXT_PUBLIC_APP_URL?.includes('localhost');
    const response = await serveStaticFile(serveDir, targetPath, isLocalDev ? slug : undefined);
    if (!response) {
      return NextResponse.json(
        { error: 'Static files not found. Try redeploying.' },
        { status: 404 }
      );
    }
    if (!targetPath.startsWith('/_next') && targetPath !== '/favicon.ico') {
      prisma.proxyHit.create({
        data: {
          projectId: deployment.projectId,
          path: targetPath,
          referer: request.headers.get('referer') ?? null,
          device: detectDevice(request.headers.get('user-agent') ?? ''),
        },
      }).catch(() => {});
    }
    return response;
  }

  if (!deployment.containerPort) {
    return NextResponse.json(
      { error: `No active deployment found for "${slug}"` },
      { status: 404 }
    );
  }

  const targetUrl = `http://127.0.0.1:${deployment.containerPort}${targetPath}${request.nextUrl.search}`;

  // Build forwarded headers — strip hop-by-hop, host, accept-encoding, and
  // cookie (prevents leaking the auth-token to the deployed container).
  const forwardHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && k !== 'host' && k !== 'accept-encoding' && k !== 'cookie') {
      forwardHeaders.set(key, value);
    }
  }
  forwardHeaders.set('x-forwarded-host', request.headers.get('host') ?? '');
  forwardHeaders.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: hasBody ? request.body : undefined,
      // duplex is required by Node.js fetch when body is a ReadableStream
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(hasBody && ({ duplex: 'half' } as any)),
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to reach the deployed app. It may still be starting up.' },
      { status: 502 }
    );
  }

  // Forward response headers, filtering hop-by-hop and decompression artifacts
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && !STRIP_RESPONSE.has(k)) {
      responseHeaders.set(key, value);
    }
  }

  // Record hit async — skip internal Next.js asset paths
  if (!targetPath.startsWith('/_next') && targetPath !== '/favicon.ico') {
    prisma.proxyHit.create({
      data: {
        projectId: deployment.projectId,
        path: targetPath,
        referer: request.headers.get('referer') ?? null,
        device: detectDevice(request.headers.get('user-agent') ?? ''),
      },
    }).catch(() => {});
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
