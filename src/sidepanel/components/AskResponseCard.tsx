import { motion, useReducedMotion } from 'framer-motion';
import type { AskQuestionSource } from '../../../shared/types';
import { formatTime } from '../utils/formatTime';

interface AskResponseCardProps {
  query: string;
  answer: string;
  timestampSeconds: number;
  sources: AskQuestionSource[];
}

const CARD_TRANSITION = {
  duration: 0.4,
  ease: [0.16, 1, 0.3, 1] as const,
};

export const AskResponseCard = ({
  query,
  answer,
  timestampSeconds,
  sources,
}: AskResponseCardProps) => {
  const prefersReducedMotion = useReducedMotion();
  const transition = prefersReducedMotion ? { duration: 0 } : CARD_TRANSITION;

  return (
    <motion.div
      layout
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={transition}
      className="relative pl-[72px]"
    >
      <div className="absolute left-0 top-[14px] w-[36px] pr-1 text-right">
        <span className="rail-timestamp font-mono text-[10px] font-medium tracking-[0.05em] text-accentSoft/76">
          {formatTime(timestampSeconds)}
        </span>
      </div>

      <span
        className="absolute left-[42px] top-[20px] h-[9px] w-[9px] bg-accentSoft"
        style={{
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          boxShadow: '0 0 10px rgba(224, 204, 157, 0.18)',
        }}
      />
      <span
        className="absolute left-[50px] top-[24px] h-px w-[14px]"
        style={{ background: 'linear-gradient(90deg, rgba(224, 204, 157, 0.72), transparent)' }}
      />

      <div className="query-console relative ml-1 px-4 py-4">
        <div className="mb-3 flex items-start gap-2 border-b border-surfaceBorder/30 pb-3">
          <span className="mt-0.5 shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-accentSoft/52">
            You asked
          </span>
          <p className="ask-card-query text-[12px] leading-[1.52] tracking-[-0.006em] text-textMain/78">
            "{query}"
          </p>
        </div>

        <p className="ask-card-answer text-[13px] leading-[1.65] tracking-[-0.01em] text-textMain/94">
          {answer}
        </p>

        {sources.length > 0 && (
          <div className="mt-4 border-t border-surfaceBorder/30 pt-3">
            <p className="ask-card-sources-label font-mono text-[9px] uppercase tracking-[0.14em] text-textMuted/48">
              Sourced from
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {sources.map((source, index) => (
                source.url ? (
                  <a
                    key={`${source.title}-${index}`}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ask-card-source-link truncate text-[11px] text-accentSoft/78 transition-colors hover:text-accent"
                  >
                    {source.title}
                  </a>
                ) : (
                  <p
                    key={`${source.title}-${index}`}
                    className="ask-card-source-copy truncate text-[11px] text-textMuted/78"
                  >
                    {source.title}
                  </p>
                )
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
