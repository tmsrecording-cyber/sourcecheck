/**
 * YouTube transcript adapter.
 *
 * Implements TranscriptAdapter for youtube.com/watch pages.
 * All YouTube-specific DOM parsing and transcript extraction logic lives here
 * (or delegates to transcript.ts). The worker pipeline and backend APIs remain
 * source-agnostic and never import from this file.
 */

import { extractTranscriptData } from '../transcript';
import type { TranscriptSourceContext } from '../../../shared/types';
import type { TranscriptAdapter } from './transcript-adapter';

const cleanText = (text: string) => text.trim().replace(/\s+/g, ' ');

/** Reads the first VideoObject from page-level JSON-LD structured data. */
const getStructuredData = (): Record<string, unknown> | null => {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
  );

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent || 'null') as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const videoObject = (items as Array<Record<string, unknown>>).find(
        (item) => item?.['@type'] === 'VideoObject'
      );
      if (videoObject) return videoObject;
    } catch {
      // Ignore malformed structured data blocks.
    }
  }

  return null;
};

export const youTubeAdapter: TranscriptAdapter = {
  sourceType: 'youtube',
  visibility: 'public',

  canHandle(location: Location): boolean {
    return (
      location.pathname === '/watch' &&
      new URLSearchParams(location.search).has('v')
    );
  },

  getVideoId(location: Location): string | null {
    return new URLSearchParams(location.search).get('v');
  },

  buildSourceContext(sourceId: string, sourceLabel: string): TranscriptSourceContext {
    return {
      type: 'youtube',
      visibility: 'public',
      sourceId,
      sourceLabel,
    };
  },

  extractMetadata(doc: Document): { title: string; channel: string } {
    const structuredData = getStructuredData();

    const titleCandidates = [
      doc.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent,
      doc.querySelector('h1.title yt-formatted-string')?.textContent,
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      doc.querySelector('meta[name="title"]')?.getAttribute('content'),
      (structuredData?.name as string | undefined),
      doc.title.replace(/\s*-\s*YouTube$/, ''),
    ].filter((c): c is string => typeof c === 'string');

    const channelCandidates = [
      doc.querySelector('#owner #channel-name a')?.textContent,
      doc.querySelector('#owner-name a')?.textContent,
      doc.querySelector('ytd-channel-name a')?.textContent,
      doc.querySelector('link[itemprop="name"]')?.getAttribute('content'),
      doc.querySelector('meta[itemprop="author"]')?.getAttribute('content'),
      (structuredData?.author as { name?: string } | undefined)?.name,
    ].filter((c): c is string => typeof c === 'string');

    const title = titleCandidates.map(cleanText).find(Boolean) || 'Unknown Title';
    const channel = channelCandidates.map(cleanText).find(Boolean) || 'Unknown Channel';

    return { title, channel };
  },

  // Delegates directly to the existing YouTube extraction pipeline.
  // TranscriptExtractionResult is assignable to Promise<TranscriptExtractionResult | null>.
  extractTranscript: extractTranscriptData,
};
