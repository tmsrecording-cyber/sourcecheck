import { describe, expect, it } from 'vitest';

type PlayerResponseLookupResult = {
  playerResponse: Record<string, unknown> | null;
  hasCaptionTracks: boolean;
  source: 'html';
  reason: 'caption-tracks-found' | 'partial-no-captions' | 'parse-failed' | 'missing' | 'video-mismatch';
};

const hasCaptionTracks = (playerResponse: Record<string, unknown> | null) => {
  const tracks = (playerResponse as {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: unknown[];
      };
    };
  } | null)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  return Array.isArray(tracks) && tracks.length > 0;
};

const isResponseForVideo = (playerResponse: Record<string, unknown> | null, videoId: string) =>
  (playerResponse as { videoDetails?: { videoId?: string } } | null)?.videoDetails?.videoId === videoId;

const lookupPlayerResponse = (
  playerResponse: Record<string, unknown> | null,
  videoId: string
): PlayerResponseLookupResult => {
  if (!playerResponse) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source: 'html',
      reason: 'missing',
    };
  }

  if (!isResponseForVideo(playerResponse, videoId)) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source: 'html',
      reason: 'video-mismatch',
    };
  }

  if (!hasCaptionTracks(playerResponse)) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source: 'html',
      reason: 'partial-no-captions',
    };
  }

  return {
    playerResponse,
    hasCaptionTracks: true,
    source: 'html',
    reason: 'caption-tracks-found',
  };
};

function resolveHtmlLookup(params: {
  videoId: string;
  markerPlayerResponse: Record<string, unknown> | null;
  captionTrackResponse: Record<string, unknown> | null;
  parseFailed?: boolean;
}): PlayerResponseLookupResult {
  const markerLookup = params.markerPlayerResponse
    ? lookupPlayerResponse(params.markerPlayerResponse, params.videoId)
    : null;

  if (markerLookup?.hasCaptionTracks) {
    return markerLookup;
  }

  if (params.captionTrackResponse && hasCaptionTracks(params.captionTrackResponse)) {
    return {
      playerResponse: params.captionTrackResponse,
      hasCaptionTracks: true,
      source: 'html',
      reason: 'caption-tracks-found',
    };
  }

  if (markerLookup?.reason === 'video-mismatch') {
    return markerLookup;
  }

  if (params.markerPlayerResponse && isResponseForVideo(params.markerPlayerResponse, params.videoId)) {
    return {
      playerResponse: null,
      hasCaptionTracks: false,
      source: 'html',
      reason: 'partial-no-captions',
    };
  }

  if (params.parseFailed) {
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
}

describe('transcript HTML fallback regression', () => {
  it('prefers extracted caption tracks over a stale mismatched player response blob', () => {
    const result = resolveHtmlLookup({
      videoId: 'current-video',
      markerPlayerResponse: {
        videoDetails: { videoId: 'stale-video' },
      },
      captionTrackResponse: {
        videoDetails: { videoId: 'current-video' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ baseUrl: 'https://example.com/captions' }],
          },
        },
      },
    });

    expect(result.reason).toBe('caption-tracks-found');
    expect(result.hasCaptionTracks).toBe(true);
  });
});
