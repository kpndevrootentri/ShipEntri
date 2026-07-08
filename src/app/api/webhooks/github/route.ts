import { NextRequest, NextResponse } from 'next/server';
import { webhookService } from '@/services/webhook';
import { deploymentService } from '@/services/deployment';
import { auditLogRepository } from '@/repositories/audit-log.repository';
import { checkWebhookRateLimit } from '@/lib/rate-limit';
import { verifySignature, parsePushRef, parsePushRepoFullName } from '@/lib/github-webhook';
import { createLogger } from '@/lib/logger';

const log = createLogger('webhook-github');

/**
 * POST /api/webhooks/github — public GitHub push webhook ingress.
 *
 * This endpoint is unauthenticated; security rests entirely on the per-project
 * HMAC signature (X-Hub-Signature-256) verified against the raw body. It responds
 * fast (202/204) and never builds inline — all work goes through the existing
 * deployment queue — to stay within GitHub's 10s delivery timeout.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  // Rate-limit by source IP to blunt abuse of the public endpoint.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const limited = checkWebhookRateLimit(ip);
  if (limited) return limited;

  // Only handle push events; ack everything else so GitHub doesn't retry.
  const event = req.headers.get('x-github-event');
  if (event !== 'push') {
    return new NextResponse(null, { status: 204 });
  }

  // Raw body is required to verify the HMAC — cannot use req.json().
  const raw = await req.text();

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON' } }, { status: 400 });
  }

  const repoFullName = parsePushRepoFullName(payload as never);
  const branch = parsePushRef(payload as never);
  if (!repoFullName || !branch) {
    // Tag push, branch delete, or malformed payload — nothing to deploy.
    return new NextResponse(null, { status: 204 });
  }

  const signature = req.headers.get('x-hub-signature-256');

  // Find every auto-deploy project matching this repo+branch and verify each
  // against its own secret. Verification is per-project because secrets differ.
  const projects = await webhookService.findProjectsForPush(repoFullName, branch);
  if (projects.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  let triggered = 0;
  let anyVerified = false;
  for (const project of projects) {
    const secret = webhookService.getSecret(project);
    if (!secret || !verifySignature(raw, signature, secret)) {
      continue;
    }
    anyVerified = true;

    try {
      const { deployment } = await deploymentService.createDeploymentFromWebhook(project.id);
      triggered++;
      auditLogRepository.create({
        action: 'DEPLOY_TRIGGERED_WEBHOOK',
        targetKey: deployment.id,
        userId: project.userId,
        projectId: project.id,
      }).catch(() => {});
    } catch (err) {
      // Don't fail the whole delivery if one project's enqueue errors.
      log.warn('Webhook deployment trigger failed', { projectId: project.id, error: String(err) });
    }
  }

  if (!anyVerified) {
    // Signature matched no project's secret — reject as unauthorized.
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } },
      { status: 401 },
    );
  }

  return NextResponse.json({ success: true, data: { triggered } }, { status: 202 });
}
