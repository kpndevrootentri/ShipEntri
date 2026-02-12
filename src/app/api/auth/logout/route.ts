import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth-cookie';

/**
 * POST /api/auth/logout – clears auth cookie.
 */
export async function POST(): Promise<NextResponse<unknown>> {
  const res = NextResponse.json({ success: true });
  clearAuthCookie(res);
  return res;
}
