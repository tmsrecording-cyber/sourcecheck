import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Info, X } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { SidepanelNotice } from '../utils/notices';
import { getNoticeArrival, getPressSettle } from '../styles/motionTokens';

const NOTICE_TONES = {
  accent: {
    rgb: '138, 180, 248',
    icon: Info,
  },
  success: {
    rgb: '129, 201, 149',
    icon: CheckCircle2,
  },
  warning: {
    rgb: '253, 226, 147',
    icon: Info,
  },
} as const;

export const NoticeStack = ({
  notices,
  onDismiss,
}: {
  notices: SidepanelNotice[];
  onDismiss: (id: string) => void;
}) => {
  const prefersReducedMotion = useReducedMotion();
  const pressFeedback = getPressSettle(prefersReducedMotion);

  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="sidepanel-notice-stack" aria-live="polite" aria-atomic="true">
      <AnimatePresence initial={false}>
        {notices.map((notice) => {
          const tone = NOTICE_TONES[notice.tone];
          const Icon = tone.icon;

          const arrival = getNoticeArrival(prefersReducedMotion);

          return (
            <motion.div
              key={notice.id}
              className="sidepanel-notice"
              initial={arrival.initial}
              animate={arrival.animate}
              exit={arrival.exit}
              transition={arrival.transition}
              style={{ '--notice-rgb': tone.rgb } as CSSProperties}
            >
              <div className="sidepanel-notice-icon" aria-hidden="true">
                <Icon size={11} strokeWidth={1.8} />
              </div>
              <div className="sidepanel-notice-copy">
                <p className="sidepanel-notice-title">{notice.title}</p>
                <p className="sidepanel-notice-message">{notice.message}</p>
              </div>
              <motion.button
                type="button"
                className="sidepanel-notice-dismiss"
                onClick={() => onDismiss(notice.id)}
                aria-label="Dismiss notice"
                whileTap={pressFeedback}
              >
                <X size={10} strokeWidth={2} />
              </motion.button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
