import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { handleApiError } from '@/lib/api-error';
import { dockerTerminalService } from '@/services/docker/docker-terminal.service';
import { ValidationError, AppError } from '@/lib/errors';

const terminalCommandSchema = z.object({
    command: z.string().min(1, 'Command is required').max(1000, 'Command too long'),
});

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/terminal – execute command inside project container.
 */
export async function POST(
    req: NextRequest,
    { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
    try {
        const session = await getSession(req);
        const { id: projectId } = await params;

        const body = await req.json();
        const parsed = terminalCommandSchema.safeParse(body);
        if (!parsed.success) {
            throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
        }

        const project = await projectService.getByIdWithDeployments(projectId, session.userId);

        const latestDeployment = (project as { deployments: Array<{ status: string }> }).deployments?.[0];
        if (!latestDeployment || latestDeployment.status !== 'DEPLOYED') {
            throw new AppError('NOT_DEPLOYED', 'Project is not currently deployed', 400);
        }

        const containerName = `dropdeploy-${(project as { slug: string }).slug}`;
        const command = parsed.data.command;

        // Route slash commands vs regular commands
        const result = command.startsWith('/')
            ? await dockerTerminalService.executeSlashCommand(containerName, command)
            : await dockerTerminalService.executeCommand(containerName, command);

        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        // Surface command-validation / container errors with a friendly message
        if (error instanceof Error && !(error instanceof AppError)) {
            return NextResponse.json(
                {
                    success: false,
                    error: { code: 'TERMINAL_ERROR', message: error.message },
                },
                { status: 400 },
            );
        }
        return handleApiError(error);
    }
}
