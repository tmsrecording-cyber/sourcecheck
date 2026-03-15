/**
 * Security tests for backend/src/proxy.ts
 *
 * Fix 1: Rate-limit bucket cannot be spoofed via X-Extension-Id
 *   — auth runs before rate-limiting; identity derived from validated Origin only
 *
 * Fix 3: Extension requests rejected (fail closed) when ALLOWED_EXTENSION_IDS is unset
 *   — previously any local extension was permitted if the env var was absent
 *
 * Session auth: Deployed backends require a backend-issued session token.
 *   — shared client secret (EXTENSION_API_TOKEN) is fully replaced by SESSION_SECRET
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Test-request factory
//
// proxy.ts accesses these members of NextRequest:
//   request.method
//   request.headers.get(name)
//   request.nextUrl.hostname
//   request.nextUrl.pathname
//   request.clone().text()          ← body size check
// ---------------------------------------------------------------------------
function makeRequest(
  url: string,
  {
    method = 'POST',
    headers: extraHeaders = {},
    body = '{}',
  }: { method?: string; headers?: Record<string, string>; body?: string } = {}
): NextRequest {
  const parsed = new URL(url);
  const headers = new Headers(extraHeaders);
  // content-length avoids the clone().text() path for the size check
  if (!extraHeaders['content-length']) {
    headers.set('content-length', String(new TextEncoder().encode(body).byteLength));
  }
  return {
    method,
    headers,
    nextUrl: { hostname: parsed.hostname, pathname: parsed.pathname },
    clone: () => ({ text: () => Promise.resolve(body) }),
  } as unknown as NextRequest;
}

const ANALYZE_URL = 'http://localhost:3000/api/analyze-chunk';
const DEPLOYED_ANALYZE_URL = 'https://api.sourcecheck.example/api/analyze-chunk';
const SESSION_INIT_URL = 'https://api.sourcecheck.example/api/session/init';
const SESSION_INIT_LOCAL_URL = 'http://localhost:3000/api/session/init';

// ---------------------------------------------------------------------------
// Fix 1 — Rate-limit bucket cannot be spoofed via X-Extension-Id
// ---------------------------------------------------------------------------
describe('Fix 1: Rate-limit bucket cannot be spoofed via X-Extension-Id', () => {
  // Use vi.resetModules() in beforeEach so each test gets a freshly-initialized
  // proxy module with empty rateLimitBuckets.
  beforeEach(() => {
    vi.resetModules();
    process.env.ALLOWED_EXTENSION_IDS = 'real-ext-id';
    delete process.env.SESSION_SECRET;
    delete process.env.RATE_LIMIT_MAX_POINTS;
  });

  afterEach(() => {
    delete process.env.ALLOWED_EXTENSION_IDS;
  });

  it('PASS: spoofed X-Extension-Id is rejected at auth — quota is never consumed', async () => {
    const { proxy } = await import('../src/proxy');

    // Origin says real-ext-id but x-extension-id header is attacker's value.
    const req = makeRequest(ANALYZE_URL, {
      headers: {
        origin: 'chrome-extension://real-ext-id',
        'x-extension-id': 'attacker-ext-id',   // mismatches Origin hostname
      },
    });

    const res = await proxy(req);

    // Must be rejected at auth — rate-limit code never runs, so real quota is safe.
    expect(res.status).toBe(403);
  });

  it('PASS: verified extension is correctly rate-limited under its own identity', async () => {
    // Set limit low enough that a single analyze-chunk call (cost=2) fills the bucket.
    process.env.RATE_LIMIT_MAX_POINTS = '2';
    const { proxy } = await import('../src/proxy');

    const makeVerified = () =>
      makeRequest(ANALYZE_URL, {
        headers: {
          origin: 'chrome-extension://real-ext-id',
          'x-extension-id': 'real-ext-id',
        },
      });

    const first = await proxy(makeVerified());
    expect(first.status).not.toBe(403);   // auth passes
    expect(first.status).not.toBe(429);   // first call is within budget

    const second = await proxy(makeVerified());
    expect(second.status).toBe(429);      // second call exceeds budget
  });

  it('PASS: attacker cannot exhaust verified extension quota via spoofed X-Extension-Id', async () => {
    process.env.RATE_LIMIT_MAX_POINTS = '2';
    const { proxy } = await import('../src/proxy');

    // Attacker repeatedly sends requests with a wrong Origin but spoofed x-extension-id.
    // All should be rejected at auth, leaving real-ext-id's quota untouched.
    for (let i = 0; i < 10; i++) {
      const attackReq = makeRequest(ANALYZE_URL, {
        headers: {
          origin: 'chrome-extension://not-in-allowlist',   // fails isAllowedExtensionOrigin
          'x-extension-id': 'real-ext-id',                 // spoofed — cannot help
        },
      });
      const attackRes = await proxy(attackReq);
      expect(attackRes.status).toBe(403);  // rejected before rate-limiter
    }

    // Real extension should still have its full quota available.
    const realReq = makeRequest(ANALYZE_URL, {
      headers: {
        origin: 'chrome-extension://real-ext-id',
        'x-extension-id': 'real-ext-id',
      },
    });
    const realRes = await proxy(realReq);
    expect(realRes.status).not.toBe(429);  // quota was NOT poisoned
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — Fail closed when ALLOWED_EXTENSION_IDS is not configured
// ---------------------------------------------------------------------------
describe('Fix 3: All extension requests rejected when ALLOWED_EXTENSION_IDS is unset', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SESSION_SECRET;
    delete process.env.ALLOWED_EXTENSION_IDS;
  });

  afterEach(() => {
    delete process.env.ALLOWED_EXTENSION_IDS;
  });

  it('PASS: extension with allowlisted ID is permitted when allowlist is configured', async () => {
    process.env.ALLOWED_EXTENSION_IDS = 'allowed-ext-id';
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(ANALYZE_URL, {
      headers: {
        origin: 'chrome-extension://allowed-ext-id',
        'x-extension-id': 'allowed-ext-id',
      },
    });
    const res = await proxy(req);

    expect(res.status).not.toBe(403);
  });

  it('FAIL: extension with non-allowlisted ID is rejected when allowlist is configured', async () => {
    process.env.ALLOWED_EXTENSION_IDS = 'allowed-ext-id';
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(ANALYZE_URL, {
      headers: {
        origin: 'chrome-extension://rogue-ext-id',
        'x-extension-id': 'rogue-ext-id',
      },
    });
    const res = await proxy(req);

    expect(res.status).toBe(403);
  });

  it('PASS: extensions allowed on localhost when ALLOWED_EXTENSION_IDS is not set', async () => {
    // No ALLOWED_EXTENSION_IDS set — localhost allows any extension for local dev.
    // Deployed (non-localhost) hosts still fail closed.
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(ANALYZE_URL, {
      headers: {
        origin: 'chrome-extension://any-ext-id',
        'x-extension-id': 'any-ext-id',
      },
    });
    const res = await proxy(req);

    expect(res.status).toBe(200);
  });

  it('PASS: security warning is emitted exactly once when allowlist is absent on localhost', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { proxy } = await import('../src/proxy');

    // Multiple extension IDs, all allowed on localhost — warning must be deduplicated.
    for (const id of ['ext-a', 'ext-b', 'ext-c']) {
      await proxy(
        makeRequest(ANALYZE_URL, {
          headers: { origin: `chrome-extension://${id}`, 'x-extension-id': id },
        })
      );
    }

    const allowlistWarnings = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === 'string' && msg.includes('ALLOWED_EXTENSION_IDS')
    );
    expect(allowlistWarnings).toHaveLength(1);  // warned once, not per-request

    warnSpy.mockRestore();
  });

  it('FAIL: extensions rejected on non-localhost when ALLOWED_EXTENSION_IDS is not set (fail closed)', async () => {
    const { proxy } = await import('../src/proxy');

    // Simulate a deployed host — hostname is not localhost/127.0.0.1
    const req = makeRequest('https://api.sourcecheck.app/api/analyze-chunk', {
      headers: {
        origin: 'chrome-extension://any-ext-id',
        'x-extension-id': 'any-ext-id',
      },
    });
    const res = await proxy(req);

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Session token auth — deployed backend requires backend-issued token
// ---------------------------------------------------------------------------
describe('Session auth: deployed backend requires a valid session token', () => {
  const TEST_SECRET = 'test-session-secret-for-proxy-tests';

  beforeEach(() => {
    vi.resetModules();
    process.env.ALLOWED_EXTENSION_IDS = 'trusted-ext-id';
    process.env.SESSION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.ALLOWED_EXTENSION_IDS;
    delete process.env.SESSION_SECRET;
  });

  it('FAIL: deployed backend rejects request with no session token', async () => {
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(DEPLOYED_ANALYZE_URL, {
      headers: {
        'x-extension-id': 'trusted-ext-id',
        // No Authorization header
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it('FAIL: deployed backend rejects request with a tampered session token', async () => {
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(DEPLOYED_ANALYZE_URL, {
      headers: {
        'x-extension-id': 'trusted-ext-id',
        authorization: 'Bearer invalidpayload.invalidsignature',
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it('PASS: deployed backend accepts a valid backend-issued session token', async () => {
    const { proxy, issueSessionToken } = await import('../src/proxy');

    const token = await issueSessionToken('trusted-ext-id');
    expect(token).not.toBe('');

    const req = makeRequest(DEPLOYED_ANALYZE_URL, {
      headers: {
        'x-extension-id': 'trusted-ext-id',
        authorization: `Bearer ${token}`,
      },
    });

    const res = await proxy(req);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('FAIL: token issued for a different extension ID is rejected', async () => {
    const { proxy, issueSessionToken } = await import('../src/proxy');

    // Token for 'other-ext-id', but request claims 'trusted-ext-id'.
    const token = await issueSessionToken('other-ext-id');

    const req = makeRequest(DEPLOYED_ANALYZE_URL, {
      headers: {
        'x-extension-id': 'trusted-ext-id',
        authorization: `Bearer ${token}`,
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it('PASS: session/init path is exempt from bearer token requirement', async () => {
    const { proxy } = await import('../src/proxy');

    // No Authorization header — should still pass because it is the issuance point.
    const req = makeRequest(SESSION_INIT_URL, {
      headers: {
        'x-extension-id': 'trusted-ext-id',
        // No Authorization header
      },
    });

    const res = await proxy(req);
    // Proxy allows through; Next.js would route to the handler.
    // In the test harness NextResponse.next() returns status 200.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('FAIL: session/init is still rejected when extension ID is not in allowlist', async () => {
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(SESSION_INIT_URL, {
      headers: {
        'x-extension-id': 'unlisted-ext-id',
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it('PASS: issueSessionToken returns empty string when SESSION_SECRET is not set', async () => {
    delete process.env.SESSION_SECRET;
    const { issueSessionToken } = await import('../src/proxy');

    const token = await issueSessionToken('any-ext-id');
    expect(token).toBe('');
  });

  it('PASS: localhost skips token requirement when SESSION_SECRET is not set', async () => {
    delete process.env.SESSION_SECRET;
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(ANALYZE_URL, {
      headers: {
        origin: 'chrome-extension://trusted-ext-id',
        'x-extension-id': 'trusted-ext-id',
        // No Authorization header
      },
    });

    const res = await proxy(req);
    expect(res.status).not.toBe(403);
  });

  it('PASS: localhost enforces token requirement when SESSION_SECRET IS set', async () => {
    // SESSION_SECRET is set → requiresSessionToken returns true even on localhost.
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(ANALYZE_URL, {
      headers: {
        origin: 'chrome-extension://trusted-ext-id',
        'x-extension-id': 'trusted-ext-id',
        // No Authorization header
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);  // token is required
  });

  it('PASS: session init on localhost exempt from token even when SESSION_SECRET is set', async () => {
    const { proxy } = await import('../src/proxy');

    const req = makeRequest(SESSION_INIT_LOCAL_URL, {
      headers: {
        'x-extension-id': 'trusted-ext-id',
        // No Authorization header
      },
    });

    const res = await proxy(req);
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting: durability and bucket isolation
// ---------------------------------------------------------------------------
describe('Rate limiting: durability and bucket isolation', () => {
  // analyze-chunk costs 2 points; set max to 4 so two calls exhaust the bucket.
  beforeEach(() => {
    vi.resetModules();
    process.env.ALLOWED_EXTENSION_IDS = 'ext-a,ext-b';
    delete process.env.SESSION_SECRET;
    process.env.RATE_LIMIT_MAX_POINTS = '4';
  });

  afterEach(() => {
    delete process.env.ALLOWED_EXTENSION_IDS;
    delete process.env.RATE_LIMIT_MAX_POINTS;
  });

  it('PASS: quota persists across adapter recreation (durable-store simulation)', async () => {
    // A shared Map backing represents an external durable store (Redis in production).
    const { InMemoryRateLimitStore } = await import('../src/lib/rate-limit-store');
    const sharedBuckets = new Map();

    // --- Process instance 1: consume full quota ---
    const { proxy: proxy1, setRateLimitStore: setStore1 } = await import('../src/proxy');
    setStore1(new InMemoryRateLimitStore(sharedBuckets));

    const makeExtReq = () =>
      makeRequest(ANALYZE_URL, {
        headers: { origin: 'chrome-extension://ext-a', 'x-extension-id': 'ext-a' },
      });

    expect((await proxy1(makeExtReq())).status).not.toBe(429); // 2/4 consumed
    expect((await proxy1(makeExtReq())).status).not.toBe(429); // 4/4 consumed — bucket full

    // --- Simulate process restart ---
    vi.resetModules();

    // --- Process instance 2: inject same backing state ---
    const { InMemoryRateLimitStore: InMemoryRateLimitStore2 } =
      await import('../src/lib/rate-limit-store');
    const { proxy: proxy2, setRateLimitStore: setStore2 } = await import('../src/proxy');
    setStore2(new InMemoryRateLimitStore2(sharedBuckets));

    // Quota must still be exhausted from before the simulated restart.
    expect((await proxy2(makeExtReq())).status).toBe(429);
  });

  it('PASS: separate extension identities have independent rate-limit buckets', async () => {
    const { InMemoryRateLimitStore } = await import('../src/lib/rate-limit-store');
    const { proxy, setRateLimitStore } = await import('../src/proxy');
    setRateLimitStore(new InMemoryRateLimitStore());

    const makeReq = (id: string) =>
      makeRequest(ANALYZE_URL, {
        headers: { origin: `chrome-extension://${id}`, 'x-extension-id': id },
      });

    // Exhaust ext-a's bucket (cost 2 per call, max 4).
    await proxy(makeReq('ext-a'));
    await proxy(makeReq('ext-a'));
    expect((await proxy(makeReq('ext-a'))).status).toBe(429);

    // ext-b's bucket must be completely unaffected.
    expect((await proxy(makeReq('ext-b'))).status).not.toBe(429);
  });
});
