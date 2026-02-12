import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { createProjectSchema } from '@/validators/project.validator';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/projects – list current user's projects.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const projects = await projectService.listByUser(session.userId);
    return NextResponse.json({ success: true, data: projects });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/projects – create a new project.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const body = await req.json();
    const dto = createProjectSchema.parse(body);
    const project = await projectService.create(session.userId, dto);
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
