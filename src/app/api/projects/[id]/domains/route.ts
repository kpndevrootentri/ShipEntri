import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { domainService } from '@/services/domain';
import { addDomainSchema } from '@/validators/domain.validator';
import { handleApiError } from '@/lib/api-error';
import { checkDomainMutationRateLimit } from '@/lib/rate-limit';
import { ValidationError } from '@/lib/errors';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/domains – list the project's custom domains (owner only).
 */
export async function GET(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const domains = await domainService.list(id, session.userId);
    return NextResponse.json({ success: true, data: domains });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/projects/:id/domains – claim a hostname for the project (owner only).
 *
 * Rate-limited: each add mints a verification token and a row in a globally
 * unique namespace, so an unthrottled endpoint would let one user squat every
 * hostname another user might want.
 */
export async function POST(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const limited = checkDomainMutationRateLimit(session.userId);
    if (limited) return limited;

    const { id } = await params;
    const body = await req.json();
    const parsed = addDomainSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    const domain = await domainService.add(id, session.userId, parsed.data);
    return NextResponse.json({ success: true, data: domain }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
