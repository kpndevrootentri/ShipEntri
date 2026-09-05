import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { domainService } from '@/services/domain';
import { handleApiError } from '@/lib/api-error';
import { checkDomainVerifyRateLimit } from '@/lib/rate-limit';

type RouteCtx = { params: Promise<{ id: string; domainId: string }> };

/**
 * POST /api/projects/:id/domains/:domainId/verify – run a DNS check now (owner only).
 *
 * Rate-limited harder than the other mutations: each call makes several
 * outbound DNS queries, so it is the cheapest way to turn this API into a
 * traffic amplifier against a third party's nameservers. The background
 * re-check job means users rarely need to press it more than once anyway.
 */
export async function POST(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const limited = checkDomainVerifyRateLimit(session.userId);
    if (limited) return limited;

    const { id, domainId } = await params;
    const domain = await domainService.verify(id, session.userId, domainId);
    return NextResponse.json({ success: true, data: domain });
  } catch (error) {
    return handleApiError(error);
  }
}
