/**
 * TranscriptAdapter — the contract every transcript source must satisfy.
 *
 * Adding a new source (e.g. Google Meet) means implementing this interface and
 * registering the adapter in the content-script orchestrator. No changes are
 * needed to the worker pipeline or backend APIs.
 */

import type {
  TranscriptSourceContext,
  TranscriptSourceType,
  TranscriptSourceVisibility,
  TranscriptFetchDebugEntry,
} from '../../../shared/types';
import type { TranscriptChunk, TranscriptExtractionResult } from '../transcript';

export interface TranscriptAdapter {
  /** Identifies which source platform this adapter handles */
  readonly sourceType: TranscriptSourceType;

  /** Default content visibility for this source */
  readonly visibility: TranscriptSourceVisibility;

  /** Returns true if this adapter can handle the current page URL */
  canHandle(location: Location): boolean;

  /** Extracts the source identifier from the URL (e.g. YouTube video ID) */
  getVideoId(location: Location): string | null;

  /** Builds a TranscriptSourceContext for the given source ID and label */
  buildSourceContext(sourceId: string, sourceLabel: string): TranscriptSourceContext;

  /** Extracts video title and channel name from the current document */
  extractMetadata(document: Document): { title: string; channel: string };

  /**
   * Fetches and parses the full transcript for the given source.
   * Returns null only on a clean "no transcript available" signal;
   * throws on unexpected errors.
   *
   * Live-caption sources (e.g. Meet) return null immediately and use
   * startLiveCapture instead of this method.
   */
  extractTranscript(
    videoId: string,
    signal: AbortSignal,
    onFetchDebug: (entry: Omit<TranscriptFetchDebugEntry, 'at'>) => void,
    options: { allowPanelAutoOpen?: boolean },
  ): Promise<TranscriptExtractionResult | null>;

  /**
   * Optional: live-caption adapters implement this instead of (or in addition to)
   * extractTranscript. When present, the content-script orchestrator bypasses the
   * static-fetch retry loop and drives ingestion via the onChunk callback.
   *
   * The adapter is responsible for calling onChunk whenever a flush-worthy chunk
   * of caption text is ready. It must stop producing chunks when the signal fires.
   */
  startLiveCapture?: (
    meetingId: string,
    signal: AbortSignal,
    onChunk: (chunk: TranscriptChunk) => void,
    onFetchDebug: (entry: Omit<TranscriptFetchDebugEntry, 'at'>) => void,
  ) => void;
}
