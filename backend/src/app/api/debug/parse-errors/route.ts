/**
 * Debug endpoint for PARSE_ERROR evidence.
 * Returns structured counts and recent samples for analysis.
 * 
 * NO PII — only counts, lengths, and categorical data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getParseErrorCounts, getParseErrorSummary, clearParseEvidence } from '@/lib/parse-evidence';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Simple auth: require a debug token in prod, allow localhost in dev
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
    clearParseEvidence();
    return NextResponse.json({ cleared: true });
  }

  const summary = getParseErrorSummary();
  const counts = getParseErrorCounts();

  return NextResponse.json({
    summary,
    counts,
    note: 'Evidence resets on deploy. This is for parser reliability analysis only.',
  });
}
