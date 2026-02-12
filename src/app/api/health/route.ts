import { NextResponse } from 'next/server';

/**
 * Health check for load balancers and monitoring.
 */
export async function GET(): Promise<NextResponse<{ status: string }>> {
  return NextResponse.json({ status: 'ok' });
}
