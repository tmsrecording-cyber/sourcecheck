import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

interface FoldAccordionProps {
  header: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * FoldAccordion - 3D origami-style accordion
 * 
 * Content folds down from top like a page being turned.
 * Uses perspective and rotateX for realistic 3D effect.
 */
export const FoldAccordion = ({
  header,
  children,
  defaultExpanded = false,
  className = '',
}: FoldAccordionProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const prefersReducedMotion = useReducedMotion();

  const toggle = () => setIsExpanded((prev) => !prev);

  // 3D fold animation variants
  const contentVariants = {
    hidden: {
      rotateX: -90,
      opacity: 0,
      transformOrigin: 'top center' as const,
      transformPerspective: 1200,
      transition: {
        duration: prefersReducedMotion ? 0 : 0.35,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      },
    },
    visible: {
      rotateX: 0,
      opacity: 1,
      transformOrigin: 'top center' as const,
      transformPerspective: 1200,
      transition: {
        duration: prefersReducedMotion ? 0 : 0.4,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      },
    },
  };

  const chevronVariants = {
    collapsed: { rotate: 0 },
    expanded: { rotate: 180 },
  };

  return (
    <div className={`fold-container ${className}`}>
      {/* Header - acts as the hinge */}
      <button
        type="button"
        onClick={toggle}
        className="fold-header w-full text-left focus-ring"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">{header}</div>
          <motion.div
            className="ml-2 text-sc-muted/60"
            variants={chevronVariants}
            initial="collapsed"
            animate={isExpanded ? 'expanded' : 'collapsed'}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="chevron"
            >
              <path
                d="M4 6L8 10L12 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.div>
        </div>
      </button>

      {/* Content - folds down like a page */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FoldAccordion;
