import { NextRequest } from 'next/server';
import { getTokenFromCookie } from '@/lib/auth-cookie';
import { authService } from '@/services/auth';
import { UnauthorizedError } from '@/lib/errors';

export interface Session {
  userId: string;
  email: string;
}

/**
 * Returns the current user session from the request cookie.
 * Throws UnauthorizedError if not logged in or token invalid.
 */
export async function getSession(req: NextRequest): Promise<Session> {
  const token = getTokenFromCookie(req);
  if (!token) {
    throw new UnauthorizedError('Not authenticated');
  }
  const payload = await authService.verifyToken(token);
  return { userId: payload.sub, email: payload.email };
}
