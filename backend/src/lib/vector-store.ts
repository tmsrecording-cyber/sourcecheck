/**
 * Upstash Vector Store for Cross-Video Memory
 * 
 * Stores claim embeddings for semantic similarity search across videos.
 * This enables instant recall of previously verified claims without calling Gemini API.
 */

import { Index } from '@upstash/vector';
import type { ClaimFeatureVector } from '@/types/shared';

// Environment variables
const UPSTASH_VECTOR_REST_URL = process.env.UPSTASH_VECTOR_REST_URL;
const UPSTASH_VECTOR_REST_TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN;

// Configuration
const VECTOR_INDEX_NAME = 'sourcecheck-claims';
const SIMILARITY_THRESHOLD = 0.92; // Minimum cosine similarity for a match
const MAX_RESULTS = 1; // We only need the best match

interface ClaimVector {
  id: string;
  claimText: string;
  normalizedClaimText?: string;
  claimFeatures?: ClaimFeatureVector;
  checkworthiness?: number;
  normalizationVersion?: number;
  status: 'supported' | 'partial' | 'disputed' | 'unverifiable';
  nuance: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceType: string;
  videoId: string;
  videoTitle: string;
  timestampSeconds: number;
  verifiedAt: string;
  wordingVersion: number; // For cache invalidation when user-facing wording changes
}

interface VectorMatch {
  id: string;
  score: number;
  metadata: ClaimVector;
}

let vectorClient: Index | null = null;

/**
 * Initialize the Upstash Vector client
 * Returns null if credentials are not configured (graceful degradation)
 */
function getVectorClient(): Index | null {
  if (vectorClient) return vectorClient;
  
  if (!UPSTASH_VECTOR_REST_URL || !UPSTASH_VECTOR_REST_TOKEN) {
    console.warn('[vector-store] UPSTASH_VECTOR credentials not configured, skipping vector search');
    return null;
  }
  
  try {
    vectorClient = new Index({
      url: UPSTASH_VECTOR_REST_URL,
      token: UPSTASH_VECTOR_REST_TOKEN,
    });
    return vectorClient;
  } catch (error) {
    console.error('[vector-store] Failed to initialize vector client:', error);
    return null;
  }
}

/**
 * Expected vector dimension - must match the Upstash Vector index configuration.
 * Current index was created with 768 dimensions.
 * Note: gemini-embedding-2-preview produces 3072-dim vectors, so we project down.
 */
const EXPECTED_VECTOR_DIMENSION = 768;

const validateEmbedding = (embedding: number[]): void => {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('embedding must be a non-empty array');
  }

  if (embedding.some((value) => !Number.isFinite(value))) {
    throw new Error('embedding contains non-finite values');
  }
};

/**
 * Project high-dimensional embedding to expected dimension using averaging.
 * This preserves semantic meaning while matching index configuration.
 */
function projectEmbedding(embedding: number[], targetDim: number): number[] {
  validateEmbedding(embedding);

  if (embedding.length === targetDim) return embedding;
  if (embedding.length < targetDim) {
    throw new Error(`embedding dimension ${embedding.length} is smaller than target ${targetDim}`);
  }
  
  // Simple averaging projection: group dimensions and average
  const ratio = embedding.length / targetDim;
  const projected: number[] = [];
  
  for (let i = 0; i < targetDim; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    const width = end - start;
    if (width <= 0) {
      throw new Error(`invalid projection bucket width at index ${i}`);
    }
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += embedding[j];
    }
    const average = sum / width;
    if (!Number.isFinite(average)) {
      throw new Error(`projection produced non-finite value at index ${i}`);
    }
    projected.push(average);
  }
  
  return projected;
}

const getProjectedEmbedding = (
  embedding: number[],
  context: 'upsert' | 'findSimilar' | 'findRelated',
): number[] | null => {
  try {
    return projectEmbedding(embedding, EXPECTED_VECTOR_DIMENSION);
  } catch (error) {
    console.warn(
      `[vector-store] Skipping ${context}:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
};

/**
 * Upsert a claim vector to the index
 * Called after successful claim verification
 */
export async function upsertClaimVector(
  claimData: ClaimVector,
  embedding: number[]
): Promise<void> {
  const client = getVectorClient();
  if (!client) return;
  
  const projectedEmbedding = getProjectedEmbedding(embedding, 'upsert');
  if (!projectedEmbedding) return;
  
  try {
    await client.upsert({
      id: claimData.id,
      vector: projectedEmbedding,
      metadata: {
        claimText: claimData.claimText,
        ...(claimData.normalizedClaimText ? { normalizedClaimText: claimData.normalizedClaimText } : {}),
        ...(claimData.claimFeatures ? { claimFeatures: claimData.claimFeatures } : {}),
        ...(typeof claimData.checkworthiness === 'number' ? { checkworthiness: claimData.checkworthiness } : {}),
        ...(typeof claimData.normalizationVersion === 'number' ? { normalizationVersion: claimData.normalizationVersion } : {}),
        status: claimData.status,
        nuance: claimData.nuance,
        sourceTitle: claimData.sourceTitle,
        sourceUrl: claimData.sourceUrl,
        sourceType: claimData.sourceType,
        videoId: claimData.videoId,
        videoTitle: claimData.videoTitle,
        timestampSeconds: claimData.timestampSeconds,
        verifiedAt: claimData.verifiedAt,
        wordingVersion: claimData.wordingVersion,
      },
    });
    
    console.log('[vector-store] Claim vector upserted:', claimData.id);
  } catch (error) {
    console.error('[vector-store] Failed to upsert claim vector:', error);
    // Fail silently - don't break the verification flow
  }
}

/**
 * Find similar claims using vector similarity search
 * Returns the best match if similarity exceeds threshold
 */
export async function findSimilarClaim(
  embedding: number[],
  threshold: number = SIMILARITY_THRESHOLD
): Promise<VectorMatch | null> {
  const client = getVectorClient();
  if (!client) return null;
  
  const projectedEmbedding = getProjectedEmbedding(embedding, 'findSimilar');
  if (!projectedEmbedding) return null;
  
  try {
    const results = await client.query({
      vector: projectedEmbedding,
      topK: MAX_RESULTS,
      includeMetadata: true,
    });
    
    if (!results || results.length === 0) {
      return null;
    }
    
    const bestMatch = results[0];
    
    // Check if similarity exceeds threshold
    if (bestMatch.score < threshold) {
      return null;
    }
    
    return {
      id: String(bestMatch.id),
      score: bestMatch.score,
      metadata: bestMatch.metadata as unknown as ClaimVector,
    };
  } catch (error) {
    console.error('[vector-store] Failed to query similar claims:', error);
    return null;
  }
}

// Configuration for related claim lookups (Phase D intelligence layer)
const RELATED_SIMILARITY_THRESHOLD = 0.78;
const MAX_RELATED_RESULTS = 5; // Fetch 5, filter down to 3 best

/**
 * Find RELATED claims (not exact matches) for adversarial verification context.
 * Returns up to 3 related claims with their verification history.
 * Uses a lower similarity threshold (0.78) than exact-match dedup (0.92).
 */
export async function findRelatedClaims(
  embedding: number[],
): Promise<VectorMatch[]> {
  const client = getVectorClient();
  if (!client) return [];

  const projectedEmbedding = getProjectedEmbedding(embedding, 'findRelated');
  if (!projectedEmbedding) return [];

  try {
    const results = await client.query({
      vector: projectedEmbedding,
      topK: MAX_RELATED_RESULTS,
      includeMetadata: true,
    });

    if (!results || results.length === 0) return [];

    // Filter to related range (0.78 - 0.91) — above 0.92 is an exact match handled separately
    // Also exclude unverifiable results (stale, not useful as prior intelligence)
    return results
      .filter((r) => {
        const meta = r.metadata as unknown as ClaimVector;
        return r.score >= RELATED_SIMILARITY_THRESHOLD
          && r.score < SIMILARITY_THRESHOLD
          && meta.status !== 'unverifiable';
      })
      .slice(0, 3)
      .map((r) => ({
        id: String(r.id),
        score: r.score,
        metadata: r.metadata as unknown as ClaimVector,
      }));
  } catch (error) {
    console.error('[vector-store] Failed to query related claims:', error);
    return [];
  }
}

/**
 * Check if vector store is available
 */
export function isVectorStoreAvailable(): boolean {
  return !!getVectorClient();
}

// Re-export types
export type { ClaimVector, VectorMatch };
