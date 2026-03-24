import { motion } from 'framer-motion';

import type { SourceCard } from '../../../shared/types';
import { FeedCard } from './FeedCard';
import { handoffGhostMotion } from '../styles/motionTokens';

interface HandoffGhostProps {
  card: SourceCard;
  sourceRect: DOMRect;
  targetRect: DOMRect;
  currentVideoId?: string | null;
}

export const HandoffGhost = ({
  card,
  sourceRect,
  targetRect,
  currentVideoId = null,
}: HandoffGhostProps) => {
  return (
    <motion.div
      data-testid="handoff-ghost"
      aria-hidden="true"
      className="handoff-ghost"
      initial={{
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
        opacity: 0.96,
        scale: handoffGhostMotion.startScale,
      }}
      animate={{
        left: targetRect.left,
        top: targetRect.top,
        width: targetRect.width,
        height: targetRect.height,
        opacity: 0.84,
        scale: handoffGhostMotion.endScale,
      }}
      transition={handoffGhostMotion.transition}
    >
      <FeedCard
        size="compact"
        card={card}
        timestampSeconds={card.timestampSeconds}
        accentRgb="154, 160, 166"
        currentVideoId={currentVideoId}
        suppressEntry
        emphasis="secondary"
        showRail={false}
        surfaceMode="ghost"
      />
    </motion.div>
  );
};

export default HandoffGhost;
