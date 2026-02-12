import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/services/auth';
import { getTokenFromCookie } from '@/lib/auth-cookie';
import { UnauthorizedError } from '@/lib/errors';

/**
 * GET /api/auth/session – returns current user from cookie JWT.
 * Returns 200 with data: null when not logged in or token invalid.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  const token = getTokenFromCookie(req);
  if (!token) {
    return NextResponse.json({ success: true, data: null }, { status: 200 });
  }
  try {
    const payload = await authService.verifyToken(token);
    return NextResponse.json({
      success: true,
      data: { userId: payload.sub, email: payload.email },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ success: true, data: null }, { status: 200 });
    }
    throw e;
  }
}
