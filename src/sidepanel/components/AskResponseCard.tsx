import { motion, useReducedMotion } from 'framer-motion';
import type { AskQuestionSource } from '../../../shared/types';
import { formatTime } from '../utils/formatTime';
import { getAskResponseEntry } from '../styles/motionTokens';

interface AskResponseCardProps {
  query: string;
  answer: string;
  timestampSeconds: number;
  sources: AskQuestionSource[];
}

export const AskResponseCard = ({
  query,
  answer,
  timestampSeconds,
  sources,
}: AskResponseCardProps) => {
  const prefersReducedMotion = useReducedMotion();
  const entry = getAskResponseEntry(prefersReducedMotion);

  return (
    <motion.div
      layout
      initial={entry.initial}
      animate={entry.animate}
      transition={entry.transition}
      className="ask-response-card relative feed-rail-offset"
    >
      <div className="absolute left-0 top-[14px] w-[30px] text-right">
        <span className="rail-timestamp font-mono text-[10px] font-medium tracking-[0.05em] text-sc-accent opacity-80">
          {formatTime(timestampSeconds)}
        </span>
      </div>

      <span
        className="ask-response-rail-node absolute top-[20px] h-[9px] w-[9px] bg-sc-accent"
      />
      <span
        className="ask-response-rail-connector absolute top-[24px] h-px w-[14px]"
      />

      <div className="query-console ask-response-shell relative ml-1 px-4 py-4">
        <div className="ask-card-query-row mb-3 flex items-start gap-2 border-b border-sc-border-soft pb-3">
          <span className="ask-card-kicker mt-0.5 shrink-0">
            Asked
          </span>
          <p className="ask-card-query">
            "{query}"
          </p>
        </div>

        <p className="ask-card-answer">
          {answer}
        </p>

        {sources.length > 0 && (
          <div className="ask-card-sources mt-4 border-t border-sc-border-soft pt-3">
            <p className="ask-card-sources-label">
              Referenced
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {sources.map((source, index) => (
                source.url ? (
                  <a
                    key={`${source.title}-${index}`}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ask-card-source-link truncate text-[11px] text-sc-accent opacity-80 transition-colors hover:opacity-100"
                  >
                    {source.title}
                  </a>
                ) : (
                  <p
                    key={`${source.title}-${index}`}
                    className="ask-card-source-copy truncate text-[11px] text-sc-muted/78"
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
