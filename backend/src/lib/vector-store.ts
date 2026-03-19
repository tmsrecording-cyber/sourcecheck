/**
 * Upstash Vector Store for Cross-Video Memory
 * 
 * Stores claim embeddings for semantic similarity search across videos.
 * This enables instant recall of previously verified claims without calling Gemini API.
 */

import { Index } from '@upstash/vector';

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

/**
 * Project high-dimensional embedding to expected dimension using averaging.
 * This preserves semantic meaning while matching index configuration.
 */
function projectEmbedding(embedding: number[], targetDim: number): number[] {
  if (embedding.length === targetDim) return embedding;
  
  // Simple averaging projection: group dimensions and average
  const ratio = embedding.length / targetDim;
  const projected: number[] = [];
  
  for (let i = 0; i < targetDim; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += embedding[j];
    }
    projected.push(sum / (end - start));
  }
  
  return projected;
}

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
  
  // Project embedding to match index dimension
  const projectedEmbedding = projectEmbedding(embedding, EXPECTED_VECTOR_DIMENSION);
  
  try {
    await client.upsert({
      id: claimData.id,
      vector: projectedEmbedding,
      metadata: {
        claimText: claimData.claimText,
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
  
  // Project embedding to match index dimension
  const projectedEmbedding = projectEmbedding(embedding, EXPECTED_VECTOR_DIMENSION);
  
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

/**
 * Check if vector store is available
 */
export function isVectorStoreAvailable(): boolean {
  return !!getVectorClient();
}

// Re-export types
export type { ClaimVector, VectorMatch };
