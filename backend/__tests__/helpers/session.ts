/**
 * Test helper for session token generation.
 * Used by route integration tests to provide valid auth tokens.
 */

import { vi } from 'vitest';
import { resetRateLimitStore } from '../../src/lib/rate-limit';

export const TEST_EXTENSION_ID = 'test-extension-id';
export const TEST_SECRET = 'test-session-secret-for-integration-tests';

/**
 * Set up the test environment for session auth.
 * Call in beforeEach() to ensure SESSION_SECRET is set.
 */
export function setupSessionAuthEnv() {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ALLOWED_EXTENSION_IDS = TEST_EXTENSION_ID;
  // Reset rate limit store to ensure clean state between tests
  resetRateLimitStore();
}

/**
 * Mock crypto.subtle for the test environment.
 * The real implementation uses Web Crypto API which isn't available in Node.js test env.
 * Call this in beforeEach() after setupSessionAuthEnv().
 */
export function mockCryptoSubtle() {
  const mockSubtle = {
    importKey: vi.fn().mockResolvedValue({} as CryptoKey),
    sign: vi.fn().mockImplementation(() => {
      // Return a 32-byte signature as ArrayBuffer
      return Promise.resolve(new Uint8Array(32).fill(0xAB).buffer as ArrayBuffer);
    }),
    verify: vi.fn().mockResolvedValue(true),
  };
  
  // Stub global crypto.subtle
  vi.stubGlobal('crypto', {
    ...global.crypto,
    subtle: mockSubtle,
    randomUUID: () => 'test-uuid-1234-5678-90ab-cdef12345678',
  });
  
  return mockSubtle;
}

/**
 * Create request headers with valid session auth for tests.
 * Note: Must call mockCryptoSubtle() before this to ensure token signing works.
 */
export async function createAuthHeaders(extensionId: string = TEST_EXTENSION_ID): Promise<Record<string, string>> {
  // Import dynamically to ensure mocks are in place
  const { issueSessionToken } = await import('../../src/proxy');
  const token = await issueSessionToken(extensionId);
  return {
    'origin': `chrome-extension://${extensionId}`,
    'x-extension-id': extensionId,
    'authorization': `Bearer ${token}`,
  };
}

/**
 * Create request headers WITHOUT auth (for testing 401 behavior).
 */
export function createUnauthHeaders(extensionId: string = TEST_EXTENSION_ID): Record<string, string> {
  return {
    'origin': `chrome-extension://${extensionId}`,
    'x-extension-id': extensionId,
    // No authorization header
  };
}
