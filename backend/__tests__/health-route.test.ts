import { describe, expect, it } from 'vitest';

import { GET } from '../src/app/health/route';

describe('/health route', () => {
  it('returns a non-cached ok response with basic service metadata', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(body).toMatchObject({
      status: 'ok',
      service: 'sourcecheck-backend',
    });
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(Number.isFinite(body.uptimeSeconds)).toBe(true);
  });
});
