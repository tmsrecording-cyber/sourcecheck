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
  const isQueryReady = queryDraft.trim().length > 0 && hasContext && !isThinking;

  const handleAsk = () => {
    const trimmedQuestion = queryDraft.trim();
    if (!trimmedQuestion || isThinking || !hasContext) {
      return;
    }
    onSubmit(trimmedQuestion);
  };

  return (
    <div className="relative px-4 pb-4 pt-3 bg-sc-bg-0 border-t border-sc-border-soft/80" aria-busy={isThinking}>
      {/* Decorative top glow line - softer */}
      <div className="absolute top-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-sc-line to-transparent opacity-40" />

      <label htmlFor={ASK_INPUT_ID} className="sr-only">
        Ask about what was said in this video
      </label>
      
      <div className="relative group">
        <div className={`
          flex items-center gap-3 px-3 py-2 rounded-xl
          bg-gradient-to-b from-sc-surface-0 to-[#0b0807]
          border transition-all duration-200
          ${hasContext 
            ? 'border-sc-border-strong shadow-sc-soft focus-within:border-sc-accent/60 focus-within:shadow-[0_0_24px_rgba(138,180,248,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]' 
            : 'border-sc-border-soft/60 opacity-75'
          }
        `}>
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
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-sc-text placeholder:text-sc-text-faint/70 focus:outline-none disabled:cursor-not-allowed font-sc selection:bg-sc-accent/20"
          />
          
          <button
            type="button"
            onClick={handleAsk}
            disabled={!isQueryReady}
            className={`
              mechanical-btn shrink-0 font-mono text-[10px] font-bold tracking-[0.15em] uppercase px-4 py-2.5 rounded-md
              flex items-center justify-center min-w-[60px] min-h-[32px] transition-all duration-200
              ${isQueryReady 
                ? 'bg-gradient-to-b from-sc-accent/25 to-sc-accent/10 border border-sc-accent/60 text-sc-accent hover:text-sc-text hover:border-sc-accent/80 hover:shadow-[0_0_18px_rgba(96,165,250,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] shadow-[0_0_12px_rgba(96,165,250,0.2)]' 
                : 'bg-sc-surface-1/50 border border-sc-border text-sc-text-faint/50 cursor-not-allowed'
              }
            `}
          >
            {isThinking ? (
              <span className="flex items-center gap-[4px] px-1">
                {TYPING_DOT_DELAYS.map((delay, index) => (
                  <span
                    key={index}
                    className="block h-[4px] w-[4px] rounded-full bg-sc-accent-soft animate-dot-bounce shadow-[0_0_6px_currentColor]"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            ) : (
              'Ask'
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-center text-[10.5px] font-medium leading-relaxed text-sc-disputed opacity-90 font-sc animate-reveal-down">
          {error}
        </p>
      )}
    </div>
  );
};
