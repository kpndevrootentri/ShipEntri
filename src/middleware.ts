import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';
import { getTokenFromCookie } from '@/lib/auth-cookie';

const DASHBOARD_PREFIX = '/dashboard';
const AUTH_PAGES = ['/login', '/register'];

/**
 * Protects /dashboard when no valid JWT; redirects logged-in users from /login, /register.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const token = getTokenFromCookie(request);

  let isAuthenticated = false;
  if (token) {
    const secret = process.env.JWT_SECRET;
    if (secret) {
      try {
        await jose.jwtVerify(token, new TextEncoder().encode(secret), {
          algorithms: ['HS256'],
        });
        isAuthenticated = true;
      } catch {
        // Invalid or expired token
      }
    }
  }

  if (pathname.startsWith(DASHBOARD_PREFIX) && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (AUTH_PAGES.some((p) => pathname === p) && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
};
