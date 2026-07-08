import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { webhookService } from '@/services/webhook';
import { handleApiError } from '@/lib/api-error';
import { updateProjectSchema } from '@/validators/project.validator';
import { ValidationError } from '@/lib/errors';
import { auditLogRepository } from '@/repositories/audit-log.repository';
import type { Project } from '@prisma/client';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id – get a single project with its deployments.
 */
export async function GET(
  req: NextRequest,
  { params }: RouteCtx
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const project = await projectService.getByIdWithDeployments(id, session.userId);
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/projects/:id – update project name, description, or type.
 */
export async function PATCH(
  req: NextRequest,
  { params }: RouteCtx
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const body = await req.json();
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    // autoDeploy has side effects (registers/removes a GitHub webhook), so it is
    // handled by the webhook service rather than the generic field update.
    const { autoDeploy, ...fields } = parsed.data;

    let project: Project | undefined;
    if (Object.keys(fields).length > 0) {
      project = await projectService.update(id, session.userId, fields);
    }
    if (autoDeploy !== undefined) {
      project = autoDeploy
        ? await webhookService.enableAutoDeploy(id, session.userId)
        : await webhookService.disableAutoDeploy(id, session.userId);
    }

    // Non-blocking audit log
    auditLogRepository.create({
      action: 'PROJECT_SETTINGS_UPDATED',
      targetKey: Object.keys(parsed.data).join(','),
      userId: session.userId,
      projectId: id,
    }).catch(() => {});

    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/projects/:id – delete a project.
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteCtx
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;

    // Write audit log before deletion (cascade would remove it after)
    await auditLogRepository.create({
      action: 'PROJECT_DELETED',
      targetKey: id,
      userId: session.userId,
      projectId: id,
    }).catch(() => {});

    // Best-effort: remove the GitHub webhook so we don't orphan it on the remote.
    await webhookService.disableAutoDeploy(id, session.userId).catch(() => {});

    await projectService.delete(id, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
