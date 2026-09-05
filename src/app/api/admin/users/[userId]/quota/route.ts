import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

const updateQuotaSchema = z
  .object({
    projectQuota: z.number().int().min(0).optional(),
    domainQuota: z.number().int().min(0).optional(),
  })
  .refine((d) => d.projectQuota !== undefined || d.domainQuota !== undefined, 'Nothing to update');

/**
 * PATCH /api/admin/users/[userId]/quota – update a user's project and/or custom-domain quota (contributor only).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userId } = await params;
    const body = await req.json();
    const { projectQuota, domainQuota } = updateQuotaSchema.parse(body);

    let user = null;
    if (projectQuota !== undefined) {
      user = await adminService.updateUserQuota(userId, projectQuota);
    }
    if (domainQuota !== undefined) {
      user = await adminService.updateUserDomainQuota(userId, domainQuota);
    }
    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    return handleApiError(error);
  }
}
