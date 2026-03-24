/**
 * Debug endpoint for recent structured telemetry.
 * Returns only categorical events already captured by the in-memory observability buffer.
 *
 * NO PII — only safe route names, categories, statuses, models, and resolution metadata.
 */

import { NextRequest, NextResponse } from 'next/server';

import { clearEventBuffer, getRecentEvents } from '@/lib/observability';

const buildCounts = (events: ReturnType<typeof getRecentEvents>) => {
  const byName: Record<string, number> = {};
  const byRoute: Record<string, number> = {};
  const byResolutionPath: Record<string, number> = {};

  for (const event of events) {
    byName[event.name] = (byName[event.name] || 0) + 1;

    if ('route' in event && event.route) {
      byRoute[event.route] = (byRoute[event.route] || 0) + 1;
    }

    if ('resolutionPath' in event && event.resolutionPath) {
      byResolutionPath[event.resolutionPath] = (byResolutionPath[event.resolutionPath] || 0) + 1;
    }
  }

  return {
    total: events.length,
    byName,
    byRoute,
    byResolutionPath,
  };
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV === 'development';
  const { searchParams } = new URL(request.url);

  if (!isDev) {
    const token = searchParams.get('token');
    if (token !== process.env.DEBUG_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const action = searchParams.get('action');
  if (action === 'clear') {
    clearEventBuffer();
    return NextResponse.json({ cleared: true });
  }

  const limitParam = Number.parseInt(searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(limitParam, 200))
    : 50;
  const events = getRecentEvents(limit);

  return NextResponse.json({
    counts: buildCounts(events),
    events,
    note: 'Telemetry buffer is in-memory only and resets on deploy/restart.',
  });
}
