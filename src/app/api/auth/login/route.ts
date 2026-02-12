import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/services/auth';
import { loginSchema } from '@/validators/auth.validator';
import { handleApiError } from '@/lib/api-error';
import { setAuthCookie, parseExpiresInToSeconds } from '@/lib/auth-cookie';
import { getConfig } from '@/lib/config';

export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const body = await req.json();
    const dto = loginSchema.parse(body);
    const result = await authService.login(dto);
    const res = NextResponse.json({
      success: true,
      data: { userId: result.userId, email: dto.email },
    });
    const maxAge = parseExpiresInToSeconds(getConfig().JWT_EXPIRES_IN);
    setAuthCookie(res, result.tokens.accessToken, maxAge);
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
