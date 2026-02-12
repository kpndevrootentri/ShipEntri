import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { deploymentService } from '@/services/deployment';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/projects/:id/deploy – create deployment (e.g. for GITHUB projects).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id: projectId } = await params;

    const deployment = await deploymentService.createDeployment(projectId, session.userId);

    return NextResponse.json({
      success: true,
      data: { deploymentId: deployment.id, message: 'Deployment queued.' },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
