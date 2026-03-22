import type { CSSProperties } from 'react';

import { formatTime } from '../utils/formatTime';
import { normalizeTranscriptPreview } from '../utils/normalizeTranscriptPreview';
import type { ReadingVariant } from '../hooks/useLiveStageFlow';

interface LiveReadingStripProps {
  variant: ReadingVariant;
  previewText?: string | null;
  timestampSeconds?: number | null;
}

export const LiveReadingStrip = ({
  variant,
  previewText = null,
  timestampSeconds = null,
}: LiveReadingStripProps) => {
  if (!variant) return null;

  const copy = variant === 'preview' && previewText
    ? normalizeTranscriptPreview(previewText)
    : 'Listening for the next spoken claim';

  return (
    <div
      className="feed-card-wrapper feed-card-wrapper-rail live-reading-strip-shell"
      style={{ '--rail-left': '44px' } as CSSProperties}
    >
      <div className="feed-card-rail">
        {timestampSeconds !== null && (
          <div className="rail-timestamp-wrap">
            <span className="rail-timestamp">{formatTime(timestampSeconds)}</span>
          </div>
        )}
        <span className="rail-line rail-line-reading" />
        <span className="rail-node live-reading-node" />
        <span className="rail-connector live-reading-connector" />
      </div>

      <div className="live-reading-strip">
        <div className="live-reading-strip-header">
          <span className="live-reading-dot" />
          <p className={`live-reading-copy ${variant === 'quiet' ? 'live-reading-copy-quiet' : ''}`}>
            {copy}
          </p>
        </div>
      </div>
    </div>
  );
};

export default LiveReadingStrip;
