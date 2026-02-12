import { NextRequest, NextResponse } from 'next/server';

export const AUTH_COOKIE_NAME = 'auth-token';

/** 7 days in seconds */
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Reads the JWT from the auth cookie.
 */
export function getTokenFromCookie(request: NextRequest): string | undefined {
  return request.cookies.get(AUTH_COOKIE_NAME)?.value;
}

/**
 * Sets the auth cookie on the response with the JWT.
 */
export function setAuthCookie(
  response: NextResponse,
  token: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE
): void {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeSeconds,
    path: '/',
  });
}

/**
 * Clears the auth cookie (logout).
 */
export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}

/**
 * Parses JWT_EXPIRES_IN (e.g. "7d") to seconds for cookie maxAge.
 */
export function parseExpiresInToSeconds(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) return DEFAULT_MAX_AGE;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'd':
      return value * 24 * 60 * 60;
    case 'h':
      return value * 60 * 60;
    case 'm':
      return value * 60;
    case 's':
      return value;
    default:
      return DEFAULT_MAX_AGE;
  }
}
