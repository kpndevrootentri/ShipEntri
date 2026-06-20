import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectAccessService } from '@/services/project-access';
import { handleApiError } from '@/lib/api-error';

type RouteCtx = { params: Promise<{ id: string; accessId: string }> };

/**
 * DELETE /api/projects/:id/access/:accessId – revoke an access entry (owner only).
 */
export async function DELETE(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id, accessId } = await params;
    await projectAccessService.revoke(id, session.userId, accessId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
