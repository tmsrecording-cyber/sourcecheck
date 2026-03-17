// ============================================
// SHARED TYPES — used by both extension & backend
// ============================================

/** Gemini model options for claim analysis/verification */
export type GeminiModelOption = 
  | 'gemini-3.1-flash-lite'
  | 'gemini-3-flash'
  | 'gemini-2.5-flash-lite';

export interface ModelConfig {
  id: GeminiModelOption;
  label: string;
  description: string;
  speed: 'fast' | 'balanced' | 'deep';
}

export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Flash 3.1 Lite',
    description: 'Fastest, lightest',
    speed: 'fast',
  },
  {
    id: 'gemini-3-flash',
    label: 'Flash 3',
    description: 'Balanced quality',
    speed: 'balanced',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Flash 2.5 Lite',
    description: 'Previous generation',
    speed: 'deep',
  },
];

/** A single timed segment from YouTube's captions */
export interface TranscriptChunk {
  text: string;
  startTime: number;   // seconds into the video
  duration: number;     // length of this segment in seconds
  index: number;        // chunk index in the full transcript
}

export interface ActiveVideoContext {
  videoId: string;
  title: string;
  channel: string;
  pageSessionId?: string;
  sourceTabId?: number;
}

export interface PlaybackState {
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate?: number;
}

export type AnalysisStatus =
  | 'idle'
  | 'loading'
  | 'monitoring'
  | 'verifying'
  | 'ready'
  | 'no-transcript'
  | 'error';

export type TranscriptDebugSource = 'window' | 'scripts' | 'html' | 'panel' | null;

export type TranscriptDebugReason =
  | 'pending'
  | 'caption-tracks-found'
  | 'no-caption-tracks'
  | 'fetch-failed'
  | 'fetch-non-ok'
  | 'fetch-empty-body'
  | 'fetch-html-instead-of-transcript'
  | 'fetch-json-no-events'
  | 'fetch-xml-no-text'
  | 'response-empty'
  | 'parse-empty'
  | 'parse-error'
  | 'parse-threw'
  | 'chunks-filtered-empty'
  | 'all-tracks-response-empty'
  | 'no-usable-track'
  | 'panel-open-button-missing'
  | 'panel-open-click-failed'
  | 'panel-root-present-no-segments'
  | 'panel-open-exhausted'
  | 'panel-scrape-empty'
  | 'timeout'
  | 'loaded'
  | null;

export interface TranscriptDebugState {
  source: TranscriptDebugSource;
  reason: TranscriptDebugReason;
  attemptCount: number;
}

export interface TranscriptFetchDebugEntry {
  at: number;
  source: 'window' | 'scripts' | 'html' | 'panel';
  step:
    | 'tracks_missing'
    | 'tracks_found'
    | 'track_candidate'
    | 'track_selected'
    | 'fetch_started'
    | 'fetch_completed'
    | 'response_text_length'
    | 'parse_started'
    | 'parse_success'
    | 'parse_empty'
    | 'parse_error'
    | 'transcript_candidate_count'
    | 'first_chunk_preview'
    | 'last_chunk_preview'
    | 'error';
  message: string;
}

export type DebugStage =
  | 'idle'
  | 'video_changed'
  | 'extracting_transcript'
  | 'transcript_status_sent'
  | 'batch_start_sent'
  | 'batch_append_sent'
  | 'transcript_loaded_sent'
  | 'transcript_failed_sent'
  | 'hydrated_from_snapshot'
  | 'processing_chunks';

export interface PendingTranscriptBufferSummary {
  present: boolean;
  receivedCount: number;
  totalCount: number;
}

export interface TranscriptMessageStats {
  startsSeen: number;
  appendsSeen: number;
  loadedSeen: number;
  failedSeen: number;
}

/** What the extension sends to /api/analyze-chunk */
export interface AnalyzeChunkRequest {
  videoId: string;
  videoTitle: string;
  channelName: string;
  chunks: TranscriptChunk[];        // batched: 2-4 chunks (~30-60s of content)
  currentTimestamp: number;          // current playback position in seconds
  model?: GeminiModelOption;         // optional model selection
}

// PARSE_ERROR: model output failed JSON parsing or schema validation.
// Distinct from BUFFERING (genuine mid-sentence hold) so the worker can log
// and count model failures separately instead of silently treating them as
// normal incomplete-phrase states.
export type ExtractionActionState = 'VERIFYING' | 'REJECTED' | 'BUFFERING' | 'PARSE_ERROR';

/** A single claim extracted by the LLM */
export type ClaimType =
  | 'statistic'
  | 'study'
  | 'historical'
  | 'surprising'
  | 'canonical';

export interface ExtractedClaim {
  id: string;                        // generated UUID
  claimText: string;                 // the factual assertion
  claimType: ClaimType;
  exactQuote: string;               // verbatim text from transcript
  timestampSeconds: number;          // approx video position
  confidence: number;                // 0-1, how confident the LLM is this is a real claim
}

/** What /api/analyze-chunk returns */
export interface AnalyzeChunkResponse {
  entities: string[];
  has_claim: boolean;
  claim_text: string | null;
  action_state: ExtractionActionState;
  reason: string;
  claims: ExtractedClaim[];
  chunkRange: {
    startIndex: number;
    endIndex: number;
  };
}

/** What the extension sends to /api/verify-claim */
export interface VerifyClaimRequest {
  claim: ExtractedClaim;
  videoTitle: string;
  channelName: string;
  model?: GeminiModelOption;         // optional model selection
  /** Surrounding transcript context to help verify ambiguous claims */
  contextTranscript?: string;
}

/** Verification status levels */
export type VerificationStatus = 'supported' | 'partial' | 'disputed' | 'unverifiable';

/** A completed source card ready for display */
export interface SourceCard {
  id: string;
  claim: ExtractedClaim;
  status: VerificationStatus;
  sourceTitle: string;               // e.g. "Šrámek et al., 2000"
  sourceUrl: string;                 // link to the source
  sourceType: 'academic_paper' | 'news_article' | 'official_source' | 'wikipedia' | 'other';
  nuance: string;                    // one-line context note
  evidenceSnippet?: string;          // specific sentence from the source used for verification
  timestampSeconds: number;
  verifiedAt: string;                // ISO timestamp
  /** IDs of similar claims from other videos (cross-video memory) */
  relatedClaimIds?: string[];
  /** Embedding vector for similarity search (not sent to client, stored server-side) */
  embedding?: number[];
}

/** What /api/verify-claim returns */
export interface VerifyClaimResponse {
  sourceCard: SourceCard;
  /** Similar claims from this user's history */
  similarClaims?: SimilarClaim[];
}

/** A similar claim found via cross-video memory */
export interface SimilarClaim {
  id: string;
  claimText: string;
  status: VerificationStatus;
  videoTitle: string;
  videoId: string;
  timestampSeconds: number;
  similarity: number;  // 0-1 cosine similarity
}

export type PendingClaimState = 'queued' | 'verifying';

export interface PendingClaimPreview {
  id: string;
  claimText: string;
  claimType: ClaimType;
  timestampSeconds: number;
  confidence: number;
  state: PendingClaimState;
}

export interface PanelSessionState {
  currentVideo?: ActiveVideoContext | null;
  transcript?: TranscriptChunk[];
  playbackState?: PlaybackState | null;
  analysisStatus?: AnalysisStatus;
  chunksScanned?: number;
  pendingClaimCount?: number;
  cardsSurfaced?: number;
  lastScannedTimestamp?: number | null;
  currentScanPreview?: string | null;
  currentScanEntities?: string[];
  currentScanActionState?: ExtractionActionState | null;
  currentScanReason?: string | null;
  sourceCards?: SourceCard[];
  pendingClaims?: PendingClaimPreview[];
  lastProcessedIndex?: number;
  transcriptLoadDeadlineAt?: number | null;
  transcriptDebug?: TranscriptDebugState | null;
  debugStage?: DebugStage;
  pendingTranscriptBufferSummary?: PendingTranscriptBufferSummary;
  transcriptMessageStats?: TranscriptMessageStats;
  /** User's preferred Gemini model */
  selectedModel?: GeminiModelOption;
}

/** What the extension sends to /api/ask-video */
export interface AskVideoQuestionRequest {
  question: string;
  videoTitle: string;
  channelName: string;
  currentTime?: number | null;
  transcriptContext: TranscriptChunk[];
  sourceCards: SourceCard[];
  model?: GeminiModelOption;  // optional model selection
}

export interface AskQuestionSource {
  title: string;
  url?: string;
}

/** What /api/ask-video returns */
export interface AskQuestionResponse {
  answer: string;
  sources?: AskQuestionSource[];
}

// ─────────────────────────────────────────────────────────────────────────────
// REDUCER TYPES — canonical worker state machine
// ─────────────────────────────────────────────────────────────────────────────

export type WorkerLifecycle =
  | 'idle'
  | 'video_detected'
  | 'playback_ready'
  | 'extracting_transcript'
  | 'transcript_buffering'
  | 'transcript_loaded'
  | 'transcript_unavailable'
  | 'analyzing'
  | 'verifying'
  | 'ready'
  | 'error';

export interface DebugEvent {
  at: number;
  type: string;
  videoId: string | null;
  lifecycle: WorkerLifecycle;
  debugStage: DebugStage;
  summary?: string;
}

export interface WorkerRuntimeState {
  lifecycle: WorkerLifecycle;
  currentVideo: ActiveVideoContext | null;
  playbackState: PlaybackState | null;
  transcriptChunkCount: number;
  transcriptDebug: TranscriptDebugState | null;
  transcriptFetchLog: TranscriptFetchDebugEntry[];
  pendingTranscriptBufferSummary: PendingTranscriptBufferSummary;
  transcriptMessageStats: TranscriptMessageStats;
  sourceCards: SourceCard[];
  pendingClaims: PendingClaimPreview[];
  chunksScanned: number;
  lastScannedTimestamp: number | null;
  currentScanPreview: string | null;
  currentScanEntities: string[];
  currentScanActionState: ExtractionActionState | null;
  currentScanReason: string | null;
  lastProcessedIndex: number;
  transcriptLoadDeadlineAt: number | null;
  debugStage: DebugStage;
  eventLog: DebugEvent[];
  /** User's preferred Gemini model */
  selectedModel: GeminiModelOption;
}
