import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Info, X } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { SidepanelNotice } from '../utils/notices';

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
    rgb: '242, 201, 76',
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

  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="sidepanel-notice-stack" aria-live="polite" aria-atomic="true">
      <AnimatePresence initial={false}>
        {notices.map((notice) => {
          const tone = NOTICE_TONES[notice.tone];
          const Icon = tone.icon;

          return (
            <motion.div
              key={notice.id}
              className="sidepanel-notice"
              initial={prefersReducedMotion ? false : { opacity: 0, y: -10, scale: 0.98 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              style={{ '--notice-rgb': tone.rgb } as CSSProperties}
            >
              <div className="sidepanel-notice-icon" aria-hidden="true">
                <Icon size={13} strokeWidth={2} />
              </div>
              <div className="sidepanel-notice-copy">
                <p className="sidepanel-notice-title">{notice.title}</p>
                <p className="sidepanel-notice-message">{notice.message}</p>
              </div>
              <button
                type="button"
                className="sidepanel-notice-dismiss"
                onClick={() => onDismiss(notice.id)}
                aria-label="Dismiss notice"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
