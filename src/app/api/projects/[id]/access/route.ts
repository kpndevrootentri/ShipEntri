import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectAccessService } from '@/services/project-access';
import { grantAccessSchema } from '@/validators/project-access.validator';
import { handleApiError } from '@/lib/api-error';
import { ValidationError } from '@/lib/errors';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/access – list the project's access entries (owner only).
 */
export async function GET(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const entries = await projectAccessService.list(id, session.userId);
    return NextResponse.json({ success: true, data: entries });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/projects/:id/access – grant access to a user (by email) or a domain (owner only).
 */
export async function POST(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;

    const body = await req.json();
    const parsed = grantAccessSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    const entry = await projectAccessService.grant(id, session.userId, parsed.data);
    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
