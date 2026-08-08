import { NextResponse } from 'next/server';
import { register } from '@/lib/metrics';

// Force dynamic — never cache; Prometheus needs a fresh scrape every time.
export const dynamic = 'force-dynamic';

/**
 * GET /api/metrics
 * Prometheus scrape endpoint. Returns metrics in Prometheus text format.
 *
 * Security: This endpoint must NOT be publicly accessible.
 * Block it at Nginx before it reaches the internet:
 *
 *   location = /api/metrics { deny all; return 403; }
 *
 * Prometheus reaches it via host-gateway (Docker internal network only).
 */
export async function GET(): Promise<NextResponse> {
  const metrics = await register.metrics();
  return new NextResponse(metrics, {
    headers: {
      'Content-Type': register.contentType,
      'Cache-Control': 'no-store',
    },
  });
}
