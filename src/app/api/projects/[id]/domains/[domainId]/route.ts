import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { domainService } from '@/services/domain';
import { updateDomainSchema } from '@/validators/domain.validator';
import { handleApiError } from '@/lib/api-error';
import { checkDomainMutationRateLimit } from '@/lib/rate-limit';
import { ValidationError } from '@/lib/errors';

type RouteCtx = { params: Promise<{ id: string; domainId: string }> };

/**
 * PATCH /api/projects/:id/domains/:domainId – set primary / redirect policy (owner only).
 */
export async function PATCH(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const limited = checkDomainMutationRateLimit(session.userId);
    if (limited) return limited;

    const { id, domainId } = await params;
    const body = await req.json();
    const parsed = updateDomainSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    const domain = await domainService.update(id, session.userId, domainId, parsed.data);
    return NextResponse.json({ success: true, data: domain });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/projects/:id/domains/:domainId – release the hostname (owner only).
 */
export async function DELETE(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id, domainId } = await params;
    await domainService.remove(id, session.userId, domainId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
