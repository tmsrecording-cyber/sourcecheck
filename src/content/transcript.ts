import type {
  TranscriptDebugReason,
  TranscriptDebugSource,
  TranscriptDebugState,
  TranscriptFetchDebugEntry,
} from '../../shared/types';

export interface TranscriptChunk {
  text: string;
  startMs: number;
  durationMs: number;
}

let panelTranscriptLatch:
  | {
      videoId: string;
      transcript: TranscriptChunk[];
    }
  | null = null;

const TRANSCRIPT_PANEL_SELECTORS = [
  'ytd-transcript-segment-renderer',
  '#segments-container ytd-transcript-segment-renderer',
  'ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer',
  'ytd-engagement-panel-section-list-renderer ytd-transcript-segment-renderer',
  'transcript-segment-view-model',
  'ytd-engagement-panel-section-list-renderer transcript-segment-view-model',
  '[target-id*="transcript"] transcript-segment-view-model',
  '[panel-target-id*="transcript"] transcript-segment-view-model',
];

const TRANSCRIPT_BUTTON_SELECTORS = [
  'ytd-video-description-transcript-section-renderer button',
  'button[aria-label*="Show transcript" i]',
  'button[aria-label*="Open transcript" i]',
  'button[aria-label*="Transcript" i]',
  'button[role="tab"]',
];

const TRANSCRIPT_MENU_BUTTON_SELECTORS = [
  'button[aria-label*="More actions" i]',
  'button[aria-label*="Actions" i]',
  'button[aria-haspopup="true"][aria-label]',
  'ytd-menu-renderer button[aria-haspopup="true"]',
  'ytd-menu-renderer yt-button-shape button',
];

const TRANSCRIPT_ROOT_SELECTORS = [
  'ytd-transcript-search-panel-renderer',
  'ytd-transcript-renderer',
  // The engagement panel container is ALWAYS in the DOM on watch pages (even when closed).
  // Without the visibility filter it triggers false-positive "panel is open" detection,
  // which skips the transcript-button-click path and waits 7.5s for segments that never
  // appear. Only match the container when YouTube has actually expanded it.
  'ytd-engagement-panel-section-list-renderer[target-id*="transcript"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
];

const TRANSCRIPT_OPEN_TEXT_PATTERN = /\b(?:show|open)\s+transcript\b/i;
const TRANSCRIPT_HIDE_TEXT_PATTERN = /\b(?:hide|close)\s+transcript\b/i;
const MENU_ITEM_SELECTORS = [
  'ytd-menu-service-item-renderer',
  'tp-yt-paper-item',
  '[role="menuitem"]',
  'ytd-button-renderer',
];

interface Json3EventSegment {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3EventSegment[];
}

interface Json3TranscriptResponse {
  events?: Json3Event[];
}

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: {
    simpleText?: string;
    runs?: Array<{
      text?: string;
    }>;
  };
  vssId?: string;
};

type PlayerResponseLookupResult = {
  playerResponse: Record<string, any> | null;
  hasCaptionTracks: boolean;
  source: Exclude<TranscriptDebugSource, 'panel' | null>;
  reason:
    | 'missing'
    | 'video-mismatch'
    | 'partial-no-captions'
    | 'caption-tracks-found'
    | 'parse-failed';
};

export type TranscriptExtractionResult = {
  transcript: TranscriptChunk[] | null;
  debug: TranscriptDebugState;
  panelFallbackAttempted: boolean;
  panelFallbackSucceeded: boolean;
};

type TranscriptExtractionOptions = {
  allowPanelAutoOpen?: boolean;
};

type TranscriptFetchDebugStep = TranscriptFetchDebugEntry['step'];

type TranscriptFetchDebugLogger = (
  entry: Omit<TranscriptFetchDebugEntry, 'at'>
) => void;

type TranscriptFetchFailureReason = Extract<
  TranscriptDebugReason,
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
>;

type TranscriptFetchCandidateFormat = 'xml' | 'json3' | 'srv3';

type TranscriptFetchAttemptResult = {
  chunks: TranscriptChunk[] | null;
  reason: TranscriptDebugReason;
  format: TranscriptFetchCandidateFormat | null;
  detail: string | null;
};

type TranscriptPanelLoadResult = {
  transcript: TranscriptChunk[] | null;
  reason: Extract<
    TranscriptDebugReason,
    | 'caption-tracks-found'
    | 'panel-open-button-missing'
    | 'panel-open-click-failed'
    | 'panel-root-present-no-segments'
    | 'panel-open-exhausted'
    | 'panel-scrape-empty'
  >;
};

type YouTubeWindow = Window & {
  ytInitialPlayerResponse?: Record<string, any> | string;
  ytplayer?: {
    config?: {
      args?: {
        player_response?: Record<string, any> | string;
      };
    };
  };
  // YouTube's internal config API (may be undefined in some contexts)
  ytcfg?: {
    get?: (key: string) => string | undefined;
    data_?: Record<string, string>;
  };
  // YouTube's legacy config object (may be undefined in some contexts)
  yt?: {
    config_?: Record<string, string>;
  };
};

const cleanTranscriptText = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const asSafeText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  try {
    return String(value);
  } catch {
    return '';
  }
};

const getElementTextSafe = (element: Element | null | undefined): string => {
  if (!element) {
    return '';
  }

  const maybeElement = element as Element & { innerText?: unknown };
  const innerText = asSafeText(maybeElement.innerText);
  if (innerText) {
    return innerText;
  }

  return asSafeText(element.textContent);
};

const splitTranscriptLines = (value: unknown): string[] =>
  asSafeText(value)
    .split('\n')
    .map((line) => cleanTranscriptText(line))
    .filter(Boolean);

const decodeHtmlEntities = (value: string): string => {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  try {
    const doc = new DOMParser().parseFromString(value, 'text/html');
    return doc.body?.textContent ?? value;
  } catch (e) {
    // Fallback: manual HTML entity decoding if DOMParser fails
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  }
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const id = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { window.clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

const getElementLabel = (element: Element) =>
  cleanTranscriptText(
    (element.textContent || '') ||
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    ''
  );

const createTranscriptDebug = (
  source: TranscriptDebugSource,
  reason: TranscriptDebugReason,
  attemptCount: number = 0
): TranscriptDebugState => ({
  source,
  reason,
  attemptCount,
});

const logTranscriptLookup = (
  source: TranscriptDebugSource,
  reason: TranscriptDebugReason | PlayerResponseLookupResult['reason'],
  extra?: Record<string, unknown>
) => {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[SourceCheck][transcript] source=${source ?? 'none'} result=${reason ?? 'none'}${suffix}`);
};

const DEBUG_TRANSCRIPT_DETAIL_LOGS =
  new URLSearchParams(window.location.search).get('sourcecheck_debug_logs') === '1';

const logTranscriptDetail = (
  source: TranscriptDebugSource,
  key: string,
  value: unknown
) => {
  if (!DEBUG_TRANSCRIPT_DETAIL_LOGS) {
    return;
  }
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  console.log(`[SourceCheck][transcript] source=${source ?? 'none'} ${key}=${serialized}`);
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const getResponsePreview = (text: string) =>
  text
    .slice(0, 200)
    .replace(/\s+/g, ' ')
    .trim();

const getChunkPreview = (chunk: TranscriptChunk | undefined) =>
  chunk ? `${chunk.startMs}-${chunk.durationMs}` : '[none]';

const isTranscriptOpenControl = (element: Element, allowPlainTranscript = false) => {
  const label = getElementLabel(element);
  if (!label) {
    return false;
  }

  if (TRANSCRIPT_HIDE_TEXT_PATTERN.test(label)) {
    return false;
  }

  if (TRANSCRIPT_OPEN_TEXT_PATTERN.test(label)) {
    return true;
  }

  return allowPlainTranscript && /^transcript$/i.test(label);
};

const getTrackName = (track: CaptionTrack | null) => {
  if (!track?.name) {
    return null;
  }

  if (typeof track.name.simpleText === 'string' && track.name.simpleText.trim()) {
    return track.name.simpleText.trim();
  }

  if (Array.isArray(track.name.runs)) {
    const joined = track.name.runs
      .map((run) => run.text || '')
      .join('')
      .trim();

    return joined || null;
  }

  return null;
};

const emitTranscriptFetchDebug = (
  logger: TranscriptFetchDebugLogger | undefined,
  source: TranscriptFetchDebugEntry['source'],
  step: TranscriptFetchDebugStep,
  message: string
) => {
  logger?.({
    source,
    step,
    message,
  });
};

export const resetTranscriptExtractionState = (videoId?: string) => {
  if (!videoId || panelTranscriptLatch?.videoId === videoId) {
    panelTranscriptLatch = null;
  }
};

const getLatchedPanelTranscript = (videoId: string) => (
  panelTranscriptLatch?.videoId === videoId ? panelTranscriptLatch.transcript : null
);

const setLatchedPanelTranscript = (videoId: string, transcript: TranscriptChunk[]) => {
  panelTranscriptLatch = {
    videoId,
    transcript,
  };
};

const extractBalancedJsonObject = (content: string, marker: string) => {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const firstBraceIndex = content.indexOf('{', markerIndex);
  if (firstBraceIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = firstBraceIndex; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === '\\') {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(firstBraceIndex, index + 1);
      }
    }
  }

  return null;
};

const extractBalancedArrayFromText = (content: string, marker: string) => {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const arrayStart = content.indexOf('[', markerIndex);
  if (arrayStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = arrayStart; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === '\\') {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '[') {
      depth += 1;
      continue;
    }

    if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(arrayStart, index + 1);
      }
    }
  }

  return null;
};

const parseCaptionTracksArray = (rawTracks: string) => {
  try {
    return JSON.parse(rawTracks);
  } catch {
    if (!rawTracks.includes('\\"')) {
      return null;
    }

    try {
      return JSON.parse(
        rawTracks
          .replace(/\\"/g, '"')
          .replace(/\\\\\//g, '\\/')
          .replace(/\\\\/g, '\\')
      );
    } catch (error) {
      console.warn('[SourceCheck] Failed to parse caption tracks fallback.', error);
      return null;
    }
  }
};

const extractCaptionTracksFromText = (content: string, videoId?: string) => {
  const markers = ['"captionTracks":', '\\"captionTracks\\":'];

  for (const marker of markers) {
    const rawTracks = extractBalancedArrayFromText(content, marker);
    if (!rawTracks) {
      continue;
    }

    const captionTracks = parseCaptionTracksArray(rawTracks);
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
      continue;
    }

    return {
      videoDetails: videoId ? { videoId } : undefined,
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks,
        },
      },
    };
  }

  return null;
};

const parseFirstPlayerResponseFromText = (
  content: string
): { playerResponse: Record<string, any> | null; markerFound: boolean; parseFailed: boolean } => {
  const markers = [
    'ytInitialPlayerResponse',
    'window["ytInitialPlayerResponse"]',
    "window['ytInitialPlayerResponse']",
  ];

  let markerFound = false;
  let parseFailed = false;

  for (const marker of markers) {
    const extracted = extractBalancedJsonObject(content, marker);
    if (!extracted) {
      continue;
    }

    markerFound = true;

    try {
      return {
        playerResponse: JSON.parse(extracted),
        markerFound: true,
        parseFailed: false,
      };
    } catch (error) {
      console.warn('[SourceCheck] Failed to parse player response text.', error);
      parseFailed = true;
    }
  }

  return {
    playerResponse: null,
    markerFound,
    parseFailed,
  };
};

const parsePlayerResponseFromScripts = (): Record<string, any> | null => {
  const scripts = Array.from(document.getElementsByTagName('script'));

  for (const script of scripts) {
    const content = script.textContent || '';
    if (!content.includes('ytInitialPlayerResponse')) continue;

    const { playerResponse } = parseFirstPlayerResponseFromText(content);
    if (playerResponse) {
      return playerResponse;
    }
  }

  return null;
};

const parsePlayerResponseCandidate = (candidate: unknown): Record<string, any> | null => {
  if (!candidate) {
    return null;
  }

  if (typeof candidate === 'string') {
    try {
      return JSON.parse(candidate) as Record<string, any>;
    } catch (error) {
      console.warn('[SourceCheck] Failed to parse in-page player response string.', error);
      return null;
    }
  }

  if (typeof candidate === 'object') {
    return candidate as Record<string, any>;
  }

  return null;
};

const parsePlayerResponseFromWindow = () => {
  const youtubeWindow = window as YouTubeWindow;
  const candidates = [
    youtubeWindow.ytInitialPlayerResponse,
    youtubeWindow.ytplayer?.config?.args?.player_response,
  ];

  for (const candidate of candidates) {
    const parsed = parsePlayerResponseCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const isResponseForVideo = (playerResponse: Record<string, any> | null, videoId: string) =>
  playerResponse?.videoDetails?.videoId === videoId;

const fetchFreshPlayerResponse = async (
  videoId: string,
  signal?: AbortSignal
): Promise<string | null> => {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });

    if (!response.ok) {
      return null;
    }

    return response.text();
  } catch (error) {
    console.warn('[SourceCheck] Failed to fetch fresh watch HTML for transcript extraction.', error);
    return null;
  }
};

// Extract InnerTube API key from page HTML using regex (Manifest V3 safe)
// Content scripts cannot access window.ytcfg directly due to isolated world
const extractInnerTubeApiKeyFromHtml = (html: string): string | null => {
  // Pattern 1: ytcfg.set({..."INNERTUBE_API_KEY":"AIza..."...})
  const setPattern = /ytcfg\.set\s*\(\s*\{[^}]*"INNERTUBE_API_KEY"\s*:\s*"(AIza[^"]+)"/;
  const setMatch = html.match(setPattern);
  if (setMatch?.[1]) return setMatch[1];

  // Pattern 2: INNERTUBE_API_KEY":"AIza..." in any script
  const keyPattern = /"INNERTUBE_API_KEY"\s*:\s*"(AIza[^"]+)"/;
  const keyMatch = html.match(keyPattern);
  if (keyMatch?.[1]) return keyMatch[1];

  // Pattern 3: ytcfg.data_.INNERTUBE_API_KEY in script assignment
  const dataPattern = /ytcfg\.data_\s*=\s*\{[^}]*"INNERTUBE_API_KEY"\s*:\s*"(AIza[^"]+)"/;
  const dataMatch = html.match(dataPattern);
  if (dataMatch?.[1]) return dataMatch[1];

  return null;
};

// Use YouTube's internal InnerTube API to fetch the player response directly.
// This is more reliable than HTML parsing on SPA navigation because ytInitialPlayerResponse
// in the window/scripts is stale (it holds the previous video's data), and the fresh HTML
// fetch can return a simplified page for programmatic requests.
const extractInnerTubeApiKey = (ytWindow: YouTubeWindow, html?: string): string | null => {
  // Try direct window access first (may work in some contexts)
  const key =
    ytWindow.ytcfg?.get?.('INNERTUBE_API_KEY') ||
    ytWindow.yt?.config_?.INNERTUBE_API_KEY ||
    ytWindow.ytcfg?.data_?.INNERTUBE_API_KEY ||
    null;
  
  if (key && typeof key === 'string' && key.startsWith('AIza')) {
    return key;
  }
  
  // Fallback: extract from HTML using regex (Manifest V3 safe)
  if (html) {
    return extractInnerTubeApiKeyFromHtml(html);
  }
  
  return null;
};

const extractInnerTubeClientVersionFromHtml = (html: string): string => {
  // Pattern 1: ytcfg.set({..."INNERTUBE_CLIENT_VERSION":"2.2024..."...})
  const setPattern = /ytcfg\.set\s*\(\s*\{[^}]*"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/;
  const setMatch = html.match(setPattern);
  if (setMatch?.[1]) return setMatch[1];

  // Pattern 2: Direct INNERTUBE_CLIENT_VERSION in script
  const versionPattern = /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/;
  const versionMatch = html.match(versionPattern);
  if (versionMatch?.[1]) return versionMatch[1];

  return '2.20240101.00.00';
};

const extractInnerTubeClientVersion = (ytWindow: YouTubeWindow, html?: string): string => {
  const version =
    ytWindow.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION') ||
    ytWindow.yt?.config_?.INNERTUBE_CLIENT_VERSION ||
    ytWindow.ytcfg?.data_?.INNERTUBE_CLIENT_VERSION ||
    null;
  
  if (version) return version;
  
  // Fallback: extract from HTML using regex (Manifest V3 safe)
  if (html) {
    return extractInnerTubeClientVersionFromHtml(html);
  }
  
  return '2.20240101.00.00';
};

const fetchPlayerResponseFromInnerTube = async (
  videoId: string,
  signal?: AbortSignal
): Promise<Record<string, any> | null> => {
  try {
    const ytWindow = window as YouTubeWindow;
    
    // Get HTML for regex extraction (Manifest V3 safe - content script can read DOM)
    const pageHtml = document.documentElement.innerHTML;
    
    // Try window access first, fallback to HTML regex extraction
    const apiKey = extractInnerTubeApiKey(ytWindow, pageHtml);
    
    if (!apiKey) {
      console.warn('[SourceCheck] No YouTube API key found in page config or HTML');
      return null;
    }
    
    const clientVersion = extractInnerTubeClientVersion(ytWindow, pageHtml);
    
    console.log('[SourceCheck] InnerTube API key extracted:', { 
      fromWindow: !!ytWindow.ytcfg?.get?.('INNERTUBE_API_KEY'),
      fromHtml: !ytWindow.ytcfg?.get?.('INNERTUBE_API_KEY') && !!apiKey 
    });

    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Youtube-Client-Name': '1',
          'X-Youtube-Client-Version': clientVersion,
        },
        credentials: 'include',
        cache: 'no-store',
        signal,
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'WEB',
              clientVersion,
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      }
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) || null;
  } catch (error) {
    console.warn('[SourceCheck] InnerTube player API request failed.', error);
    return null;
  }
};

const hasCaptionTracks = (playerResponse: Record<string, any> | null) => {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) && tracks.length > 0;
};

const lookupPlayerResponse = (
  source: Exclude<TranscriptDebugSource, 'panel' | null>,
  playerResponse: Record<string, any> | null,
  videoId: string
): PlayerResponseLookupResult => {
  if (!playerResponse) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source,
      reason: 'missing',
    };
  }

  if (!isResponseForVideo(playerResponse, videoId)) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source,
      reason: 'video-mismatch',
    };
  }

  if (!hasCaptionTracks(playerResponse)) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source,
      reason: 'partial-no-captions',
    };
  }

  return {
    playerResponse,
    hasCaptionTracks: true,
    source,
    reason: 'caption-tracks-found',
  };
};

const lookupPlayerResponseFromWindow = (videoId: string): PlayerResponseLookupResult =>
  lookupPlayerResponse('window', parsePlayerResponseFromWindow(), videoId);

const lookupPlayerResponseFromScripts = (videoId: string): PlayerResponseLookupResult =>
  lookupPlayerResponse('scripts', parsePlayerResponseFromScripts(), videoId);

const lookupPlayerResponseFromHtml = (videoId: string, html: string): PlayerResponseLookupResult => {
  const markerResult = parseFirstPlayerResponseFromText(html);
  if (markerResult.playerResponse) {
    const result = lookupPlayerResponse('html', markerResult.playerResponse, videoId);
    if (result.hasCaptionTracks) {
      return result;
    }

    if (result.reason === 'video-mismatch') {
      return result;
    }
  }

  const fromCaptionTracks = extractCaptionTracksFromText(html, videoId);
  if (fromCaptionTracks && hasCaptionTracks(fromCaptionTracks)) {
    return {
      playerResponse: fromCaptionTracks,
      hasCaptionTracks: true,
      source: 'html',
      reason: 'caption-tracks-found',
    };
  }

  if (markerResult.playerResponse && isResponseForVideo(markerResult.playerResponse, videoId)) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source: 'html',
      reason: 'partial-no-captions',
    };
  }

  if (markerResult.parseFailed) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source: 'html',
      reason: 'parse-failed',
    };
  }

  return {
    playerResponse: null,
    hasCaptionTracks: false,
    source: 'html',
    reason: 'missing',
  };
};

const getPlayerResponse = async (
  videoId: string,
  signal?: AbortSignal,
  onFetchDebug?: TranscriptFetchDebugLogger,
): Promise<{ playerResponse: Record<string, any> | null; debug: TranscriptDebugState }> => {
  const fromWindow = lookupPlayerResponseFromWindow(videoId);
  logTranscriptLookup(fromWindow.source, fromWindow.reason);
  if (fromWindow.hasCaptionTracks) {
    emitTranscriptFetchDebug(onFetchDebug, 'window', 'tracks_found', 'caption tracks found in window player response');
    return {
      playerResponse: fromWindow.playerResponse,
      debug: createTranscriptDebug('window', 'caption-tracks-found'),
    };
  }

  const fromScripts = lookupPlayerResponseFromScripts(videoId);
  logTranscriptLookup(fromScripts.source, fromScripts.reason);
  if (fromScripts.hasCaptionTracks) {
    emitTranscriptFetchDebug(onFetchDebug, 'scripts', 'tracks_found', 'caption tracks found in script player response');
    return {
      playerResponse: fromScripts.playerResponse,
      debug: createTranscriptDebug('scripts', 'caption-tracks-found'),
    };
  }

  // Try the InnerTube API before falling back to HTML parsing. It returns clean
  // JSON with the full player response (including captionTracks) and is unaffected
  // by stale ytInitialPlayerResponse on SPA navigation.
  const innerTubeData = await fetchPlayerResponseFromInnerTube(videoId, signal);
  if (innerTubeData) {
    const fromInnerTube = lookupPlayerResponse('html', innerTubeData, videoId);
    logTranscriptLookup(fromInnerTube.source, fromInnerTube.reason, { via: 'innertube' });
    if (fromInnerTube.hasCaptionTracks) {
      emitTranscriptFetchDebug(onFetchDebug, 'html', 'tracks_found', 'caption tracks found via innertube player response');
      return {
        playerResponse: fromInnerTube.playerResponse,
        debug: createTranscriptDebug('html', 'caption-tracks-found'),
      };
    }
  }

  const html = await fetchFreshPlayerResponse(videoId, signal);
  if (!html) {
    logTranscriptLookup('html', 'fetch-failed');
    return {
      playerResponse: null,
      debug: createTranscriptDebug('html', 'fetch-failed'),
    };
  }

  const fromHtml = lookupPlayerResponseFromHtml(videoId, html);
  logTranscriptLookup(fromHtml.source, fromHtml.reason);
  if (fromHtml.hasCaptionTracks) {
    emitTranscriptFetchDebug(onFetchDebug, 'html', 'tracks_found', 'caption tracks found in fetched html');
    return {
      playerResponse: fromHtml.playerResponse,
      debug: createTranscriptDebug('html', 'caption-tracks-found'),
    };
  }

  emitTranscriptFetchDebug(
    onFetchDebug,
    'html',
    'tracks_missing',
    `no caption tracks after html lookup (${fromHtml.reason})`
  );

  return {
    playerResponse: null,
    debug: createTranscriptDebug(
      'html',
      fromHtml.reason === 'parse-failed' ? 'fetch-failed' : 'no-caption-tracks'
    ),
  };
};

const getOrderedCaptionTracks = (playerResponse: Record<string, any> | null): CaptionTrack[] => {
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    return [];
  }

  const getTrackRank = (track: CaptionTrack) => {
    const isAsr = track.kind === 'asr';
    const isEnglish = track.languageCode === 'en' || track.vssId?.startsWith('.en');
    const isManualEnglish = track.languageCode === 'en' && !isAsr;
    const isOtherEnglish = isEnglish && !isAsr && !isManualEnglish;
    const isAsrEnglish = isEnglish && isAsr;

    if (isManualEnglish) return 0;
    if (isOtherEnglish) return 1;
    if (isAsrEnglish) return 2;
    return 3;
  };

  return [...captionTracks]
    .filter((track): track is CaptionTrack => Boolean(track?.baseUrl))
    .map(track => {
      // CRITICAL FIX: YouTube returns unicode ampersands that break URL parameters
      if (typeof track.baseUrl === 'string') {
        track.baseUrl = track.baseUrl.replace(/\\u0026/g, '&').replace(/\\"/g, '"');
      }
      return track;
    })
    .sort((left, right) => getTrackRank(left) - getTrackRank(right));
};

const withCaptionFormat = (transcriptUrl: string, format: 'xml' | 'json3' | 'srv3') => {
  const url = new URL(transcriptUrl);

  if (format === 'xml') {
    url.searchParams.delete('fmt');
  } else {
    url.searchParams.set('fmt', 'json3');
    if (format === 'srv3') {
      url.searchParams.set('fmt', 'srv3');
    }
  }

  // CRITICAL WAF BYPASS: YouTube drops requests without a declared web client
  if (!url.searchParams.has('c')) {
    url.searchParams.set('c', 'WEB');
    url.searchParams.set('client', 'WEB'); // Redundant client param for legacy WAF
    url.searchParams.set('cver', '2.20240228.06.00'); // Valid recent client version
  }

  return url.toString();
};

const parseTimestampToMs = (rawValue: string) => {
  const normalized = rawValue.trim().replace(/[^\d:]/g, '');
  if (!normalized || !normalized.includes(':')) {
    return null;
  }

  const parts = normalized
    .split(':')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  if (parts.some((part) => part < 0)) {
    return null;
  }

  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];

  return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1000;
};

const getTranscriptSegmentElements = () => {
  const fromRoots: HTMLElement[] = [];
  for (const root of getTranscriptRoots()) {
    for (const node of root.querySelectorAll<HTMLElement>([
      'ytd-transcript-segment-renderer',
      'transcript-segment-view-model',
    ].join(', '))) {
      if (!fromRoots.includes(node)) {
        fromRoots.push(node);
      }
    }
  }
  if (fromRoots.length > 0) {
    return fromRoots;
  }

  for (const selector of TRANSCRIPT_PANEL_SELECTORS) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    if (nodes.length > 0) {
      return nodes;
    }
  }

  return [];
};

const hasTranscriptDataInDom = () =>
  getTranscriptSegmentElements().length > 0 || scrapeTranscriptPanel().length > 0;

const getTranscriptRoots = () => {
  const roots: HTMLElement[] = [];

  for (const selector of TRANSCRIPT_ROOT_SELECTORS) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      if (!roots.includes(node)) {
        roots.push(node);
      }
    }
  }

  return roots;
};

const parseTranscriptSegmentElement = (segment: HTMLElement): TranscriptChunk | null => {
  const textCandidate =
    segment.querySelector<HTMLElement>('.segment-text')?.innerText ||
    segment.querySelector<HTMLElement>('yt-formatted-string.segment-text')?.innerText ||
    segment.querySelector<HTMLElement>('#segment-text')?.innerText ||
    segment.querySelector<HTMLElement>('.ytwTranscriptSegmentViewModelText')?.innerText ||
    segment.querySelector<HTMLElement>('.yt-core-attributed-string')?.innerText ||
    '';

  const timeCandidate =
    segment.querySelector<HTMLElement>('.segment-timestamp')?.innerText ||
    segment.querySelector<HTMLElement>('.segment-start-offset')?.innerText ||
    segment.querySelector<HTMLElement>('#start-offset')?.innerText ||
    segment.querySelector<HTMLElement>('.ytwTranscriptSegmentViewModelTimestamp')?.innerText ||
    '';

  const lines = splitTranscriptLines(getElementTextSafe(segment));

  const timestampLineIndex = lines.findIndex((line) => parseTimestampToMs(line) !== null);
  const parsedLineTimestamp = timestampLineIndex >= 0 ? parseTimestampToMs(lines[timestampLineIndex] || '') : null;
  const startMs = parseTimestampToMs(timeCandidate) ?? parsedLineTimestamp;
  const textLines = lines.filter((line, index) => (
    index !== timestampLineIndex && parseTimestampToMs(line) === null
  ));
  const text = cleanTranscriptText(textCandidate || textLines.join(' '));

  if (startMs === null || !text) {
    return null;
  }

  return {
    text,
    startMs,
    durationMs: 4000,
  };
};

const scrapeTranscriptPanel = (): TranscriptChunk[] => {
  const segments = getTranscriptSegmentElements()
    .map(parseTranscriptSegmentElement)
    .filter((segment): segment is TranscriptChunk => Boolean(segment));

  if (segments.length >= 1) {
    if (segments.length < 2) {
      return segments;
    }

    return segments.map((segment, index) => {
      const next = segments[index + 1];
      if (!next) {
        return segment;
      }

      const inferredDuration = next.startMs - segment.startMs;
      return {
        ...segment,
        durationMs: inferredDuration > 0 ? inferredDuration : segment.durationMs,
      };
    });
  }

  for (const root of getTranscriptRoots()) {
    const fallbackSegments = parseTranscriptTextBlock(getElementTextSafe(root));
    if (fallbackSegments.length > 0) {
      return fallbackSegments;
    }
  }

  return [];
};

const findTranscriptOpenButton = () => {
  for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const button = candidates.find((candidate) => isTranscriptOpenControl(candidate));
    if (button) {
      return button;
    }
  }

  const menuItems = Array.from(
    document.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTORS.join(', '))
  );

  return menuItems.find((item) => isTranscriptOpenControl(item, true)) || null;
};

const findTranscriptMenuButton = () => {
  for (const selector of TRANSCRIPT_MENU_BUTTON_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const button = candidates.find((candidate) => {
      if (!isElementActionable(candidate)) {
        return false;
      }

      const label = getElementLabel(candidate);
      if (!label) {
        return candidate.matches('[aria-haspopup="true"]');
      }

      return /\bmore actions\b|\bactions\b|\bmore\b/i.test(label);
    });

    if (button) {
      return button;
    }
  }

  return null;
};

const parseTranscriptTextBlock = (rawText: unknown): TranscriptChunk[] => {
  const lines = splitTranscriptLines(rawText);

  const chunks: TranscriptChunk[] = [];
  let currentStartMs: number | null = null;
  let currentText: string[] = [];

  const pushCurrent = () => {
    if (currentStartMs === null || currentText.length === 0) {
      return;
    }

    chunks.push({
      startMs: currentStartMs,
      durationMs: 4000,
      text: cleanTranscriptText(currentText.join(' ')),
    });
  };

  for (const line of lines) {
    if (/^transcript$/i.test(line) || /^in this video$/i.test(line) || /^timeline$/i.test(line)) {
      continue;
    }

    const parsedTimestamp = parseTimestampToMs(line);
    if (parsedTimestamp !== null) {
      pushCurrent();
      currentStartMs = parsedTimestamp;
      currentText = [];
      continue;
    }

    if (currentStartMs !== null) {
      currentText.push(line);
    }
  }

  pushCurrent();

  return chunks.map((chunk, index) => {
    const next = chunks[index + 1];
    if (!next) {
      return chunk;
    }

    const inferredDuration = next.startMs - chunk.startMs;
    return {
      ...chunk,
      durationMs: inferredDuration > 0 ? inferredDuration : chunk.durationMs,
    };
  });
};

const isElementActionable = (element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
  return true;
};

const clickElement = (element: HTMLElement): boolean => {
  // Scroll into view first — the button may exist in the DOM but be off-screen
  // or inside a collapsed section, causing getBoundingClientRect to return zero.
  element.scrollIntoView({ block: 'nearest', behavior: 'instant' });

  if (!isElementActionable(element)) {
    console.log('[SourceCheck] Transcript button found but is not actionable (hidden or zero-size).');
    // Last resort: try a plain .click() in case the element is just outside viewport
    // but its event handlers are still live (e.g. collapsed description section).
    element.click();
    return false;
  }

  const rect = element.getBoundingClientRect();
  const clientX = rect.left + Math.min(rect.width / 2, Math.max(1, rect.width - 1));
  const clientY = rect.top + Math.min(rect.height / 2, Math.max(1, rect.height - 1));
  const mouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX,
    clientY,
  };

  element.dispatchEvent(new PointerEvent('pointerdown', mouseEventInit));
  element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
  element.dispatchEvent(new PointerEvent('pointerup', mouseEventInit));
  element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
  element.dispatchEvent(new MouseEvent('click', mouseEventInit));
  element.click();
  return true;
};

const waitForTranscriptPanel = async (attempts = 20, intervalMs = 250, signal?: AbortSignal) => {
  let maxAttempts = attempts;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(intervalMs, signal);
    const panelSegments = scrapeTranscriptPanel();
    if (panelSegments.length > 0) {
      let bestSegments = panelSegments;
      let bestNodeCount = getTranscriptSegmentElements().length;
      let stablePolls = 0;

      for (let settleAttempt = 0; settleAttempt < 6; settleAttempt += 1) {
        await sleep(intervalMs, signal);
        const nextNodeCount = getTranscriptSegmentElements().length;
        const nextSegments = scrapeTranscriptPanel();
        if (nextSegments.length > bestSegments.length) {
          bestSegments = nextSegments;
        }

        if (nextNodeCount > bestNodeCount) {
          bestNodeCount = nextNodeCount;
          stablePolls = 0;
          continue;
        }

        stablePolls += 1;
        if (stablePolls >= 2) {
          break;
        }
      }

      return bestSegments;
    }

    if ((getTranscriptRoots().length > 0 || getTranscriptSegmentElements().length > 0) && maxAttempts === attempts) {
      maxAttempts += 20;
    }
  }

  return null;
};

const openTranscriptFromOverflowMenu = async (signal?: AbortSignal): Promise<TranscriptPanelLoadResult> => {
  const menuButton = findTranscriptMenuButton();
  if (!menuButton) {
    logTranscriptLookup('panel', 'panel-open-button-missing');
    return { transcript: null, reason: 'panel-open-button-missing' };
  }

  const menuButtonClicked = clickElement(menuButton);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(250, signal);

    const alreadyLoadedSegments = await waitForTranscriptPanel(4, 250, signal);
    if (alreadyLoadedSegments?.length) {
      logTranscriptLookup('panel', 'caption-tracks-found', { segments: alreadyLoadedSegments.length });
      return { transcript: alreadyLoadedSegments, reason: 'caption-tracks-found' };
    }

    const transcriptButton = findTranscriptOpenButton();
    if (!transcriptButton || transcriptButton === menuButton) {
      continue;
    }

    const transcriptButtonClicked = clickElement(transcriptButton);

    const panelSegments = await waitForTranscriptPanel(20, 250, signal);
    if (panelSegments?.length) {
      logTranscriptLookup('panel', 'caption-tracks-found', { segments: panelSegments.length });
      return { transcript: panelSegments, reason: 'caption-tracks-found' };
    }

    if (!transcriptButtonClicked) {
      logTranscriptLookup('panel', 'panel-open-click-failed');
    }
    logTranscriptLookup('panel', 'panel-scrape-empty');
    return { transcript: null, reason: 'panel-scrape-empty' };
  }

  if (!menuButtonClicked) {
    logTranscriptLookup('panel', 'panel-open-click-failed');
    return { transcript: null, reason: 'panel-open-click-failed' };
  }

  logTranscriptLookup('panel', 'panel-open-exhausted');
  return { transcript: null, reason: 'panel-open-exhausted' };
};

const loadTranscriptFromPanel = async (
  signal?: AbortSignal,
  options?: { allowAutoOpen?: boolean }
): Promise<TranscriptPanelLoadResult> => {
  // Default to false to prevent accidental auto-opening. Caller must explicitly allow.
  const allowAutoOpen = options?.allowAutoOpen ?? false;
  const existingSegments = scrapeTranscriptPanel();
  if (existingSegments.length > 0) {
    console.log(`[SourceCheck] Transcript panel already open with ${existingSegments.length} segments.`);
    logTranscriptLookup('panel', 'caption-tracks-found', { segments: existingSegments.length });
    return { transcript: existingSegments, reason: 'caption-tracks-found' };
  }

  if (!allowAutoOpen) {
    return { transcript: null, reason: 'panel-open-exhausted' };
  }

  // Try direct transcript affordances first, then the overflow menu if needed.
  let lastFailureReason: TranscriptPanelLoadResult['reason'] = 'panel-open-exhausted';
  for (let clickAttempt = 0; clickAttempt < 3; clickAttempt += 1) {
    // If transcript rows or an existing transcript root are already present, do NOT
    // click the toggle button again — that could close it. Just wait for rows.
    if (hasTranscriptDataInDom() || getTranscriptRoots().length > 0) {
      const alreadyOpenSegments = await waitForTranscriptPanel(30, 250, signal);
      if (alreadyOpenSegments?.length) {
        console.log(`[SourceCheck] Transcript panel loaded ${alreadyOpenSegments.length} segments after open.`);
        logTranscriptLookup('panel', 'caption-tracks-found', { segments: alreadyOpenSegments.length });
        return { transcript: alreadyOpenSegments, reason: 'caption-tracks-found' };
      }
      console.warn('[SourceCheck] Transcript panel root present but no segments rendered.');
      logTranscriptLookup('panel', 'panel-root-present-no-segments');
      return { transcript: null, reason: 'panel-root-present-no-segments' };
    }

    const transcriptButton = findTranscriptOpenButton();
    if (!transcriptButton) {
      const overflowSegments = await openTranscriptFromOverflowMenu(signal);
      if (overflowSegments.transcript?.length) {
        console.log(`[SourceCheck] Transcript panel fallback loaded ${overflowSegments.transcript.length} segments via overflow menu.`);
        return overflowSegments;
      }

      lastFailureReason = overflowSegments.reason;
      await sleep(clickAttempt === 0 ? 1500 : 1000, signal);
      continue;
    }

    const transcriptButtonClicked = clickElement(transcriptButton);

    const panelSegments = await waitForTranscriptPanel(20, 250, signal);
    if (panelSegments?.length) {
      console.log(`[SourceCheck] Transcript panel fallback loaded ${panelSegments.length} segments.`);
      logTranscriptLookup('panel', 'caption-tracks-found', { segments: panelSegments.length });
      return { transcript: panelSegments, reason: 'caption-tracks-found' };
    }

    lastFailureReason = transcriptButtonClicked ? 'panel-scrape-empty' : 'panel-open-click-failed';
    logTranscriptLookup('panel', lastFailureReason, { attempt: clickAttempt + 1 });
    console.warn(`[SourceCheck] Transcript panel click attempt ${clickAttempt + 1} did not render segments.`);
  }

  console.warn('[SourceCheck] Transcript panel fallback exhausted all attempts.');
  logTranscriptLookup('panel', 'panel-open-exhausted');
  return {
    transcript: null,
    reason: lastFailureReason,
  };
};

const parseXmlTranscript = (xmlText: string): TranscriptChunk[] => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // Check for parser errors
    const parserErrors = Array.from(xmlDoc.getElementsByTagName('parsererror'));
    if (parserErrors.length > 0) {
      console.warn('[SourceCheck] XML parse error:', parserErrors[0]?.textContent);
      return [];
    }
    
    const textNodes = Array.from(xmlDoc.getElementsByTagName('text'));

    return textNodes
      .map(node => ({
        text: cleanTranscriptText(decodeHtmlEntities(node.textContent || '')),
        startMs: Math.round(parseFloat(node.getAttribute('start') || '0') * 1000),
        durationMs: Math.max(1000, Math.round(parseFloat(node.getAttribute('dur') || '0') * 1000)),
      }))
      .filter((chunk) => chunk.text.length > 0);
  } catch (error) {
    console.warn('[SourceCheck] Failed to parse XML transcript:', error);
    return [];
  }
};

const analyzeXmlTranscript = (xmlText: string) => {
  let xmlDoc: Document;
  try {
    const parser = new DOMParser();
    xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  } catch (error) {
    console.log('[SourceCheck][HARD DEBUG] XML parse-threw:', error);
    return {
      rawCount: 0,
      chunks: [] as TranscriptChunk[],
      emptyReason: 'parse-threw',
    };
  }
  
  const parserErrors = Array.from(xmlDoc.getElementsByTagName('parsererror'));
  if (parserErrors.length > 0) {
    console.log('[SourceCheck][HARD DEBUG] XML parsererror:', parserErrors[0]?.textContent);
    return {
      rawCount: 0,
      chunks: [] as TranscriptChunk[],
      emptyReason: 'parse-error',
    };
  }

  const textNodes = Array.from(xmlDoc.getElementsByTagName('text'));
  
  if (textNodes.length === 0) {
    console.log('[SourceCheck][HARD DEBUG] XML has no <text> nodes');
  }
  
  const chunks = parseXmlTranscript(xmlText);
  return {
    rawCount: textNodes.length,
    chunks,
    emptyReason: textNodes.length === 0 ? 'fetch-xml-no-text' : chunks.length === 0 ? 'filtered-to-zero' : null,
  };
};

const parseJson3Transcript = (jsonText: string): TranscriptChunk[] => {
  try {
    const payload = JSON.parse(jsonText) as Json3TranscriptResponse;
    const events = Array.isArray(payload.events) ? payload.events : [];

    return events
      .map((event) => ({
        text: cleanTranscriptText(
          (event.segs || [])
            .map(segment => segment.utf8 || '')
            .join('')
        ),
        startMs: Math.max(0, Math.round(event.tStartMs || 0)),
        durationMs: Math.max(1000, Math.round(event.dDurationMs || 0)),
      }))
      .filter((chunk) => chunk.text.length > 0);
  } catch (error) {
    console.warn('[SourceCheck][HARD DEBUG] JSON3 parse error:', error);
    return [];
  }
};

const analyzeJson3Transcript = (jsonText: string) => {
  let payload: Json3TranscriptResponse;
  try {
    payload = JSON.parse(jsonText) as Json3TranscriptResponse;
  } catch (error) {
    console.log('[SourceCheck][HARD DEBUG] JSON3 parse-threw:', error);
    return {
      rawCount: 0,
      chunks: [] as TranscriptChunk[],
      emptyReason: 'parse-threw',
    };
  }
  
  const events = Array.isArray(payload.events) ? payload.events : [];
  
  // Log if no events
  if (events.length === 0) {
    console.log('[SourceCheck][HARD DEBUG] JSON3 has no events array');
  }
  
  const chunks = events
    .map((event) => ({
      text: cleanTranscriptText(
        (event.segs || [])
          .map(segment => segment.utf8 || '')
          .join('')
      ),
      startMs: Math.max(0, Math.round(event.tStartMs || 0)),
      durationMs: Math.max(1000, Math.round(event.dDurationMs || 0)),
    }))
    .filter((chunk) => chunk.text.length > 0);

  return {
    rawCount: events.length,
    chunks,
    emptyReason: events.length === 0 ? 'fetch-json-no-events' : chunks.length === 0 ? 'filtered-to-zero' : null,
  };
};

const parseSrv3Transcript = (xmlText: string): TranscriptChunk[] => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // Check for parser errors
    const parserErrors = Array.from(xmlDoc.getElementsByTagName('parsererror'));
    if (parserErrors.length > 0) {
      console.warn('[SourceCheck] SRV3 parse error:', parserErrors[0]?.textContent);
      return [];
    }
    
    const paragraphNodes = Array.from(xmlDoc.getElementsByTagName('p'));

    return paragraphNodes
      .map((node) => {
        const segmentNodes = Array.from(node.getElementsByTagName('s'));
        const text = segmentNodes.length > 0
          ? segmentNodes.map((segment) => decodeHtmlEntities(segment.textContent || '')).join(' ')
          : decodeHtmlEntities(node.textContent || '');

        return {
          text: cleanTranscriptText(text),
          startMs: Math.max(0, Math.round(parseFloat(node.getAttribute('t') || '0'))),
          durationMs: Math.max(1000, Math.round(parseFloat(node.getAttribute('d') || '0'))),
        };
      })
      .filter((chunk) => chunk.text.length > 0);
  } catch (error) {
    console.warn('[SourceCheck] Failed to parse SRV3 transcript:', error);
    return [];
  }
};

const analyzeSrv3Transcript = (xmlText: string) => {
  let xmlDoc: Document;
  try {
    const parser = new DOMParser();
    xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  } catch (error) {
    console.log('[SourceCheck][HARD DEBUG] SRV3 parse-threw:', error);
    return {
      rawCount: 0,
      chunks: [] as TranscriptChunk[],
      emptyReason: 'parse-threw',
    };
  }
  
  const parserErrors = Array.from(xmlDoc.getElementsByTagName('parsererror'));
  if (parserErrors.length > 0) {
    console.log('[SourceCheck][HARD DEBUG] SRV3 parsererror:', parserErrors[0]?.textContent);
    return {
      rawCount: 0,
      chunks: [] as TranscriptChunk[],
      emptyReason: 'parse-error',
    };
  }

  const paragraphNodes = Array.from(xmlDoc.getElementsByTagName('p'));
  
  if (paragraphNodes.length === 0) {
    console.log('[SourceCheck][HARD DEBUG] SRV3 has no <p> nodes');
  }
  
  const segmentCount = paragraphNodes.reduce(
    (count, node) => count + node.getElementsByTagName('s').length,
    0
  );
  const chunks = parseSrv3Transcript(xmlText);
  return {
    rawCount: paragraphNodes.length,
    chunks,
    emptyReason: paragraphNodes.length === 0
      ? 'fetch-xml-no-text'
      : chunks.length === 0 ? 'filtered-to-zero' : null,
  };
};

const getFailurePriority = (reason: TranscriptFetchFailureReason) => {
  // Higher = more specific/useful for debugging
  switch (reason) {
    case 'parse-threw':
      return 10;
    case 'parse-error':
      return 9;
    case 'chunks-filtered-empty':
      return 8;
    case 'fetch-json-no-events':
      return 7;
    case 'fetch-xml-no-text':
      return 6;
    case 'parse-empty':
      return 5;
    case 'fetch-html-instead-of-transcript':
      return 4;
    case 'fetch-empty-body':
      return 3;
    case 'fetch-non-ok':
      return 2;
    case 'response-empty':
      return 1;
    case 'fetch-failed':
    default:
      return 0;
  }
};

const getAttemptFailureReason = (
  result: TranscriptFetchAttemptResult
): TranscriptFetchFailureReason => {
  // Return specific failure reasons directly
  const reason = result.reason;
  if (
    reason === 'response-empty' ||
    reason === 'parse-empty' ||
    reason === 'parse-error' ||
    reason === 'parse-threw' ||
    reason === 'chunks-filtered-empty' ||
    reason === 'fetch-non-ok' ||
    reason === 'fetch-empty-body' ||
    reason === 'fetch-html-instead-of-transcript' ||
    reason === 'fetch-json-no-events' ||
    reason === 'fetch-xml-no-text'
  ) {
    return reason;
  }
  return 'fetch-failed';
};

const fetchTranscriptChunks = async (
  transcriptUrl: string,
  signal?: AbortSignal,
  onFetchDebug?: TranscriptFetchDebugLogger,
): Promise<TranscriptFetchAttemptResult> => {
  const candidates = [
    // Try the original URL first — YouTube may serve a valid format by default
    // without any &fmt override. Deduped later if it matches a variant URL.
    { format: 'xml' as const, url: transcriptUrl },
    { format: 'xml' as const, url: withCaptionFormat(transcriptUrl, 'xml') },
    { format: 'json3' as const, url: withCaptionFormat(transcriptUrl, 'json3') },
    { format: 'srv3' as const, url: withCaptionFormat(transcriptUrl, 'srv3') },
  ].filter((c, i, arr) => arr.findIndex((x) => x.url === c.url) === i); // dedupe identical URLs

  let bestFailure: TranscriptFetchAttemptResult = {
    chunks: null,
    reason: 'fetch-failed',
    format: null,
    detail: null,
  };

  for (const candidate of candidates) {
    logTranscriptDetail('html', 'fetchUrl', {
      format: candidate.format,
      url: candidate.url,
    });
    emitTranscriptFetchDebug(onFetchDebug, 'html', 'fetch_started', `${candidate.format} ${candidate.url}`);

    try {
      // Use credentials for caption requests - YouTube now requires auth
      const response = await fetch(candidate.url, {
        credentials: 'include', 
        signal
      });
      
      // Get content-type header for debugging
      const contentType = response.headers.get('content-type') || 'unknown';
      const bodyText = await response.text();

      // HARD DEBUG: Log raw response details
      console.log(`[SourceCheck][HARD DEBUG] Transcript fetch:`, {
        format: candidate.format,
        url: candidate.url,
        status: response.status,
        contentType,
        bodyLength: bodyText.length,
        bodyPreview: bodyText.slice(0, 300).replace(/\s+/g, ' '),
        startsWithDoctype: bodyText.trim().toLowerCase().startsWith('<!doctype'),
        startsWithHtml: bodyText.trim().toLowerCase().startsWith('<html'),
        startsWithXml: bodyText.trim().startsWith('<?xml'),
        looksLikeJson: bodyText.trim().startsWith('{') || bodyText.trim().startsWith('['),
      });

      logTranscriptDetail('html', 'fetchStatus', {
        format: candidate.format,
        status: response.status,
        ok: response.ok,
        finalUrl: response.url,
        contentType,
      });
      emitTranscriptFetchDebug(
        onFetchDebug,
        'html',
        'fetch_completed',
        `${candidate.format} status=${response.status} ok=${response.ok} contentType=${contentType} bytes=${bodyText.length}`
      );

      if (!response.ok) {
        const preview = getResponsePreview(bodyText);
        logTranscriptDetail('html', 'responsePreview', {
          format: candidate.format,
          text: preview,
        });
        emitTranscriptFetchDebug(
          onFetchDebug,
          'html',
          'error',
          `${candidate.format} fetch-non-ok status=${response.status} preview=${preview || '[empty]'}`
        );
        const failure: TranscriptFetchAttemptResult = {
          chunks: null,
          reason: 'fetch-non-ok',
          format: candidate.format,
          detail: `status=${response.status} contentType=${contentType} preview=${preview || '[empty]'}`,
        };
        bestFailure = getFailurePriority(failure.reason as TranscriptFetchFailureReason) >= getFailurePriority(getAttemptFailureReason(bestFailure) ?? 'fetch-failed')
          ? failure
          : bestFailure;
        console.log(`[SourceCheck] Transcript ${candidate.format} unavailable (${response.status}), trying next format.`);
        continue;
      }

      emitTranscriptFetchDebug(
        onFetchDebug,
        'html',
        'response_text_length',
        `${candidate.format} bytes=${bodyText.length} trimmedBytes=${bodyText.trim().length}`
      );

      if (!bodyText.trim()) {
        emitTranscriptFetchDebug(
          onFetchDebug,
          'html',
          'parse_empty',
          `${candidate.format} fetch-empty-body bytes=${bodyText.length}`
        );
        const failure: TranscriptFetchAttemptResult = {
          chunks: null,
          reason: 'fetch-empty-body',
          format: candidate.format,
          detail: `fetch-empty-body bytes=${bodyText.length}`,
        };
        bestFailure = getFailurePriority(failure.reason as TranscriptFetchFailureReason) >= getFailurePriority(getAttemptFailureReason(bestFailure) ?? 'fetch-failed')
          ? failure
          : bestFailure;
        console.log(`[SourceCheck][HARD DEBUG] Transcript ${candidate.format} response was empty (0 bytes after trim)`);
        continue;
      }

      // Detect HTML error pages
      const trimmedLower = bodyText.trim().toLowerCase();
      if (trimmedLower.startsWith('<!doctype') || 
          trimmedLower.startsWith('<html') ||
          trimmedLower.startsWith('<head') ||
          trimmedLower.includes('<title>')) {
        console.log(`[SourceCheck][HARD DEBUG] Transcript ${candidate.format} returned HTML instead of transcript`);
        emitTranscriptFetchDebug(
          onFetchDebug,
          'html',
          'error',
          `${candidate.format} fetch-html-instead-of-transcript received HTML page not transcript`
        );
        const failure: TranscriptFetchAttemptResult = {
          chunks: null,
          reason: 'fetch-html-instead-of-transcript',
          format: candidate.format,
          detail: 'fetch-html-instead-of-transcript: received HTML page instead of transcript',
        };
        bestFailure = getFailurePriority(failure.reason as TranscriptFetchFailureReason) >= getFailurePriority(getAttemptFailureReason(bestFailure) ?? 'fetch-failed')
          ? failure
          : bestFailure;
        continue;
      }

      try {
        logTranscriptDetail('html', 'parseMode', candidate.format);
        emitTranscriptFetchDebug(onFetchDebug, 'html', 'parse_started', candidate.format);
        
        let parseResult;
        try {
          parseResult = candidate.format === 'xml'
            ? analyzeXmlTranscript(bodyText)
            : candidate.format === 'json3'
              ? analyzeJson3Transcript(bodyText)
              : analyzeSrv3Transcript(bodyText);
        } catch (parseError) {
          console.log(`[SourceCheck][HARD DEBUG] Transcript ${candidate.format} parse threw:`, parseError);
          emitTranscriptFetchDebug(
            onFetchDebug,
            'html',
            'parse_error',
            `${candidate.format} parse-threw: ${parseError instanceof Error ? parseError.message : String(parseError)}`
          );
          const failure: TranscriptFetchAttemptResult = {
            chunks: null,
            reason: 'parse-threw',
            format: candidate.format,
            detail: `parse-threw: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          };
          bestFailure = getFailurePriority(failure.reason as TranscriptFetchFailureReason) >= getFailurePriority(getAttemptFailureReason(bestFailure) ?? 'fetch-failed')
            ? failure
            : bestFailure;
          continue;
        }
        
        const { chunks } = parseResult;
        
        console.log(`[SourceCheck][HARD DEBUG] Transcript ${candidate.format} parsed:`, {
          rawCount: parseResult.rawCount,
          chunksAfterFilter: chunks.length,
          emptyReason: (parseResult as any).emptyReason,
        });

        if (chunks.length > 0) {
          emitTranscriptFetchDebug(
            onFetchDebug,
            'html',
            'parse_success',
            `${candidate.format} rawCount=${parseResult.rawCount} chunks=${chunks.length}`
          );
          return {
            chunks,
            reason: 'loaded',
            format: candidate.format,
            detail: `${candidate.format} rawCount=${parseResult.rawCount} chunks=${chunks.length}`,
          };
        }

        const emptyReason = (parseResult as { emptyReason?: string }).emptyReason;
        // Map specific empty reasons to specific failure reasons
        const reason: TranscriptFetchFailureReason = (() => {
          switch (emptyReason) {
            case 'filtered-to-zero': return 'chunks-filtered-empty';
            case 'fetch-json-no-events': return 'fetch-json-no-events';
            case 'fetch-xml-no-text': return 'fetch-xml-no-text';
            case 'parse-threw': return 'parse-threw';
            case 'parse-error': return 'parse-error';
            default: return 'parse-empty';
          }
        })();
        emitTranscriptFetchDebug(
          onFetchDebug,
          'html',
          'parse_empty',
          `${candidate.format} parsed 0 usable chunks reason=${emptyReason} rawCount=${parseResult.rawCount}`
        );
        const failure: TranscriptFetchAttemptResult = {
          chunks: null,
          reason,
          format: candidate.format,
          detail: `${emptyReason || 'unknown'} rawCount=${parseResult.rawCount}`,
        };
        bestFailure = getFailurePriority(failure.reason as TranscriptFetchFailureReason) >= getFailurePriority(getAttemptFailureReason(bestFailure) ?? 'fetch-failed')
          ? failure
          : bestFailure;
        console.log(`[SourceCheck] Transcript ${candidate.format} parsed 0 usable chunks reason=${emptyReason} rawCount=${parseResult.rawCount}, trying next format.`);
        console.log(`[SourceCheck] Transcript ${candidate.format} parsed but contained no usable chunks, trying next format.`);
      } catch (error) {
        const preview = getResponsePreview(bodyText);
        logTranscriptDetail('html', 'responsePreview', {
          format: candidate.format,
          text: preview,
        });
        logTranscriptDetail('html', 'fetchError', {
          format: candidate.format,
          message: getErrorMessage(error),
        });
        emitTranscriptFetchDebug(
          onFetchDebug,
          'html',
          'parse_error',
          `${candidate.format} error=${getErrorMessage(error)} preview=${preview || '[empty]'}`
        );
        bestFailure = getFailurePriority('parse-error') >= getFailurePriority(getAttemptFailureReason(bestFailure) ?? 'fetch-failed')
          ? {
              chunks: null,
              reason: 'parse-error',
              format: candidate.format,
              detail: getErrorMessage(error),
            }
          : bestFailure;
        console.log(`[SourceCheck] Failed to parse transcript ${candidate.format} response, trying next format.`, error);
      }
    } catch (error) {
      logTranscriptDetail('html', 'fetchError', {
        format: candidate.format,
        message: getErrorMessage(error),
      });
      emitTranscriptFetchDebug(
        onFetchDebug,
        'html',
        'error',
        `${candidate.format} fetch error=${getErrorMessage(error)}`
      );
      bestFailure = {
        chunks: null,
        reason: 'fetch-failed',
        format: candidate.format,
        detail: getErrorMessage(error),
      };
      throw error;
    }
  }

  console.log(`[SourceCheck][HARD DEBUG] All transcript fetch attempts failed. bestFailure:`, bestFailure);
  return bestFailure;
};

export const extractTranscriptData = async (
  videoId: string,
  signal?: AbortSignal,
  onFetchDebug?: TranscriptFetchDebugLogger,
  options?: TranscriptExtractionOptions,
): Promise<TranscriptExtractionResult> => {
  // Default to false to prevent auto-opening transcript panel on first attempt.
  // Caller must explicitly pass allowPanelAutoOpen: true for fallback attempts.
  const allowPanelAutoOpen = options?.allowPanelAutoOpen ?? false;
  let panelFallbackAttempted = false;
  let panelFallbackSucceeded = false;
  const withPanelState = (
    value: Pick<TranscriptExtractionResult, 'transcript' | 'debug'>
  ): TranscriptExtractionResult => ({
    ...value,
    panelFallbackAttempted,
    panelFallbackSucceeded,
  });
  try {
    const latchedTranscript = getLatchedPanelTranscript(videoId);
    if (latchedTranscript?.length) {
      emitTranscriptFetchDebug(onFetchDebug, 'panel', 'parse_success', `latched-panel chunks=${latchedTranscript.length}`);
      return withPanelState({
        transcript: latchedTranscript,
        debug: createTranscriptDebug('panel', 'loaded'),
      });
    }

    const alreadyVisiblePanelTranscript = scrapeTranscriptPanel();
    if (alreadyVisiblePanelTranscript.length > 0) {
      setLatchedPanelTranscript(videoId, alreadyVisiblePanelTranscript);
      emitTranscriptFetchDebug(
        onFetchDebug,
        'panel',
        'parse_success',
        `visible-panel chunks=${alreadyVisiblePanelTranscript.length}`
      );
      return withPanelState({
        transcript: alreadyVisiblePanelTranscript,
        debug: createTranscriptDebug('panel', 'loaded'),
      });
    }

    const { playerResponse, debug } = await getPlayerResponse(videoId, signal, onFetchDebug);
    const trackCandidates = getOrderedCaptionTracks(playerResponse);

    const tryPanelFallback = async () => {
      panelFallbackAttempted = true;
      const panelResult = await loadTranscriptFromPanel(signal, {
        allowAutoOpen: allowPanelAutoOpen,
      });
      if (panelResult.transcript?.length) {
        panelFallbackSucceeded = true;
        setLatchedPanelTranscript(videoId, panelResult.transcript);
        return withPanelState({
          transcript: panelResult.transcript,
          debug: createTranscriptDebug('panel', 'loaded'),
        });
      }

      return withPanelState({
        transcript: null,
        debug: createTranscriptDebug('panel', panelResult.reason),
      });
    };

    if (trackCandidates.length === 0) {
      emitTranscriptFetchDebug(
        onFetchDebug,
        debug.source === null || debug.source === 'panel' ? 'html' : debug.source,
        'tracks_missing',
        'no selected caption track baseUrl'
      );
      console.warn('[SourceCheck] No captions found for this video. Trying transcript panel fallback.');
      if (allowPanelAutoOpen) {
        return tryPanelFallback();
      }

      return withPanelState({
        transcript: null,
        debug,
      });
    }

    let sawResponseEmpty = false;
    let sawParseError = false;
    let sawUsableBodyWithoutChunks = false;
    let sawFetchFailure = false;

    for (const [index, trackCandidate] of trackCandidates.entries()) {
      const isAsr = trackCandidate.kind === 'asr';
      const candidateSource = debug.source === null || debug.source === 'panel' ? 'html' : debug.source;
      logTranscriptDetail(candidateSource, 'selectedTrack', {
        baseUrl: trackCandidate.baseUrl || null,
        languageCode: trackCandidate.languageCode || null,
        kind: trackCandidate.kind || null,
        name: getTrackName(trackCandidate),
      });
      emitTranscriptFetchDebug(
        onFetchDebug,
        candidateSource,
        'track_candidate',
        `index=${index + 1}/${trackCandidates.length} baseUrl=${trackCandidate.baseUrl || 'null'} languageCode=${trackCandidate.languageCode || 'null'} kind=${trackCandidate.kind || 'null'} name=${getTrackName(trackCandidate) || 'null'} mode=${isAsr ? 'asr' : 'manual'}`
      );
      emitTranscriptFetchDebug(
        onFetchDebug,
        candidateSource,
        'track_selected',
        `baseUrl=${trackCandidate.baseUrl || 'null'} languageCode=${trackCandidate.languageCode || 'null'} kind=${trackCandidate.kind || 'null'} name=${getTrackName(trackCandidate) || 'null'}`
      );

      const transcriptResult = await fetchTranscriptChunks(trackCandidate.baseUrl || '', signal, onFetchDebug);
      
      // Log detailed track-level result
      console.log(`[SourceCheck][TRACK DEBUG] Track ${index + 1}/${trackCandidates.length} result:`, {
        languageCode: trackCandidate.languageCode,
        kind: trackCandidate.kind,
        baseUrl: trackCandidate.baseUrl?.slice(0, 200) + '...',
        success: transcriptResult.chunks && transcriptResult.chunks.length > 0,
        reason: transcriptResult.reason,
        format: transcriptResult.format,
        detail: transcriptResult.detail,
        chunkCount: transcriptResult.chunks?.length ?? 0,
      });
      
      if (transcriptResult.chunks?.length) {
        const chunks = transcriptResult.chunks;
        emitTranscriptFetchDebug(onFetchDebug, 'html', 'transcript_candidate_count', `count=${chunks.length}`);
        emitTranscriptFetchDebug(onFetchDebug, 'html', 'first_chunk_preview', getChunkPreview(chunks[0]));
        emitTranscriptFetchDebug(onFetchDebug, 'html', 'last_chunk_preview', getChunkPreview(chunks[chunks.length - 1]));
        console.log(`[SourceCheck] Extracted ${chunks.length} transcript chunks.`);
        return withPanelState({
          transcript: chunks,
          debug,
        });
      }

      // Track specific failure reasons for better debugging
      sawResponseEmpty = sawResponseEmpty || 
        transcriptResult.reason === 'response-empty' || 
        transcriptResult.reason === 'fetch-empty-body';
      sawParseError = sawParseError || 
        transcriptResult.reason === 'parse-error' ||
        transcriptResult.reason === 'parse-threw';
      sawUsableBodyWithoutChunks = sawUsableBodyWithoutChunks || (
        transcriptResult.reason === 'parse-empty' ||
        transcriptResult.reason === 'chunks-filtered-empty' ||
        transcriptResult.reason === 'fetch-json-no-events' ||
        transcriptResult.reason === 'fetch-xml-no-text'
      );
      sawFetchFailure = sawFetchFailure || 
        transcriptResult.reason === 'fetch-failed' ||
        transcriptResult.reason === 'fetch-non-ok' ||
        transcriptResult.reason === 'fetch-html-instead-of-transcript';
    }

    // Determine final reason based on what we saw
    // Priority: specific failures > generic failures
    const finalReason: TranscriptFetchFailureReason =
      sawResponseEmpty && !sawParseError && !sawUsableBodyWithoutChunks && !sawFetchFailure
        ? 'all-tracks-response-empty'
        : sawParseError
          ? 'parse-error'
          : sawUsableBodyWithoutChunks
            ? 'no-usable-track'
            : sawFetchFailure
              ? 'fetch-failed'
              : 'no-usable-track';

    // Check if this failure type is potentially recoverable via panel fallback
    const isPotentiallyRecoverable = finalReason === 'all-tracks-response-empty' || finalReason === 'no-usable-track';
    
    if (allowPanelAutoOpen && isPotentiallyRecoverable) {
      console.log('[SourceCheck] Timedtext returned empty for all candidate tracks. Trying transcript panel fallback.');
      const panelFallbackResult = await tryPanelFallback();
      if (panelFallbackResult.transcript?.length) {
        console.log(`[SourceCheck] Transcript panel fallback recovered ${panelFallbackResult.transcript.length} segments after timedtext-empty failure.`);
        return panelFallbackResult;
      }
    }

    // Summary of all track attempts
    console.log(`[SourceCheck][TRACK SUMMARY] All ${trackCandidates.length} tracks failed:`, {
      sawResponseEmpty,
      sawParseError,
      sawUsableBodyWithoutChunks,
      sawFetchFailure,
      finalReason,
      allowPanelAutoOpen,
      isPotentiallyRecoverable,
    });
    
    // UX FIX: Don't show hard failure error if fallback hasn't been attempted yet
    // for failures that might be recoverable via panel fallback on next attempt
    const suppressHardError = isPotentiallyRecoverable && !allowPanelAutoOpen;
    
    if (suppressHardError) {
      console.log(`[SourceCheck] Timedtext failed: ${finalReason}, fallback not yet attempted - suppressing user-facing error`);
      emitTranscriptFetchDebug(
        onFetchDebug,
        'html',
        'error',
        `transcript build failed reason=${finalReason} attemptedTracks=${trackCandidates.length} fallback_pending=true`
      );
    } else {
      // Real failure - both timedtext and fallback failed (or non-recoverable error)
      emitTranscriptFetchDebug(
        onFetchDebug,
        'html',
        'error',
        `transcript build failed reason=${finalReason} attemptedTracks=${trackCandidates.length}`
      );
      console.warn(`[SourceCheck] Caption tracks found but none produced a usable transcript. tracks=${trackCandidates.length} reason=${finalReason}`);
    }
    
    return withPanelState({
      transcript: null,
      debug: createTranscriptDebug('html', finalReason),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('[SourceCheck] Transcript extraction cancelled by new attempt.');
      return withPanelState({
        transcript: null,
        debug: createTranscriptDebug(null, 'pending'),
      });
    }
    console.error('[SourceCheck] Error extracting transcript:', error);
    emitTranscriptFetchDebug(onFetchDebug, 'html', 'error', getErrorMessage(error));
    return withPanelState({
      transcript: null,
      debug: createTranscriptDebug('html', 'fetch-failed'),
    });
  }
};
