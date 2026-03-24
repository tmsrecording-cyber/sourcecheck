import { createHash } from 'node:crypto';
import type { VerifyClaimRequest, VerifyClaimResponse } from '@/types/shared';

type CacheEntry = {
  expiresAt: number;
  response: VerifyClaimResponse;
};

const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();

const normalize = (value: string | null | undefined) =>
  (value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const getTtlMs = () => {
  const parsed = Number.parseInt(process.env.VERIFY_CLAIM_CACHE_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
};

const pruneExpiredEntries = (now: number) => {
  for (const [key, entry] of Array.from(cache.entries())) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
};

const pruneOverflowEntries = () => {
  if (cache.size <= MAX_ENTRIES) return;
  const overflow = cache.size - MAX_ENTRIES;
  const keys = Array.from(cache.keys());
  for (let i = 0; i < overflow; i += 1) {
    const key = keys[i];
    if (!key) break;
    cache.delete(key);
  }
};

export const buildRecentVerificationCacheKey = (params: {
  body: VerifyClaimRequest;
  effectiveModel: string | undefined;
  isBYOK: boolean;
}) => {
  const claimText = normalize(params.body.claim.normalizedClaimText || params.body.claim.claimText);
  const context = normalize(params.body.contextTranscript).slice(0, 240);
  const rawKey = JSON.stringify({
    claimText,
    claimType: params.body.claim.claimType,
    model: params.effectiveModel || 'default',
    isBYOK: params.isBYOK,
    context,
  });
  return createHash('sha256').update(rawKey).digest('hex');
};

export const getRecentVerification = (cacheKey: string): VerifyClaimResponse | null => {
  const now = Date.now();
  pruneExpiredEntries(now);
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(cacheKey);
    return null;
  }
  return structuredClone(entry.response);
};

export const setRecentVerification = (
  cacheKey: string,
  response: VerifyClaimResponse,
) => {
  const now = Date.now();
  pruneExpiredEntries(now);
  cache.set(cacheKey, {
    expiresAt: now + getTtlMs(),
    response: structuredClone(response),
  });
  pruneOverflowEntries();
};

export const resetRecentVerificationCacheForTests = () => {
  cache.clear();
};
