import type { SourceCard, TranscriptChunk } from '../../../shared/types';

interface AskBoxProps {
  transcript: TranscriptChunk[] | null;
  cards: SourceCard[];
  queryDraft: string;
  onQueryDraftChange: (value: string) => void;
  isThinking?: boolean;
  onSubmit: (query: string) => void;
  error?: string | null;
}

const TYPING_DOT_DELAYS = [0, 140, 280] as const;
const ASK_INPUT_ID = 'sourcecheck-ask-input';

export const AskBox = ({
  transcript,
  cards,
  queryDraft,
  onQueryDraftChange,
  isThinking = false,
  onSubmit,
  error = null,
}: AskBoxProps) => {
  const hasContext = (transcript?.length ?? 0) > 0 || cards.length > 0;

  const handleAsk = () => {
    const trimmedQuestion = queryDraft.trim();
    if (!trimmedQuestion || isThinking || !hasContext) {
      return;
    }

    onSubmit(trimmedQuestion);
  };

  return (
    <div className="ask-panel border-t border-[rgba(244,217,166,0.08)] px-3 pb-4 pt-3" aria-busy={isThinking}>
      <label htmlFor={ASK_INPUT_ID} className="sr-only">
        Ask about what was said in this video
      </label>
      <div className="ask-shell flex items-center gap-2.5 px-3 py-2.5">
        <input
          id={ASK_INPUT_ID}
          type="text"
          placeholder={hasContext ? 'Ask about what was said…' : 'Waiting for context…'}
          value={queryDraft}
          onChange={(event) => onQueryDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleAsk();
            }
          }}
          disabled={isThinking || !hasContext}
          aria-disabled={isThinking || !hasContext}
          className="ask-input min-w-0 flex-1 cursor-text bg-transparent text-[13.5px] text-textMain placeholder:text-textMain/36 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAsk}
          disabled={isThinking || !hasContext || queryDraft.trim().length === 0}
          className="ask-run-btn shrink-0"
          data-active={queryDraft.trim().length > 0 && hasContext && !isThinking}
        >
          {isThinking ? (
            <span className="flex items-center gap-[3px] px-1">
              {TYPING_DOT_DELAYS.map((delay, index) => (
                <span
                  key={index}
                  className="block h-1 w-1 rounded-full bg-accentSoft animate-dotBounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          ) : (
            'Ask'
          )}
        </button>
      </div>

      {error && (
        <div className="ask-error-copy mt-2 px-1 text-[11px] leading-relaxed text-disputed/90">
          {error}
        </div>
      )}
    </div>
  );
};
