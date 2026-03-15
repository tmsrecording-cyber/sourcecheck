import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const SHOW_DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type {
  AskQuestionSource,
  AnalysisStatus,
  ExtractionActionState,
  PendingClaimPreview,
  SourceCard,
  VerificationStatus,
} from '../../../shared/types';
import { SourceCard as LiveResultCard } from './SourceCard';
import { AskResponseCard } from './AskResponseCard';
import { getContextForEntity, type ContextSnippet } from './thoughtContext';
import { formatTime } from '../utils/formatTime';
import { panelTones } from '../styles/panelTokens';

interface CardFeedProps {
  askHistory?: Array<{
    query: string;
    answer: string;
    timestampSeconds: number;
    sources: AskQuestionSource[];
  }>;
  cards: SourceCard[];
  pendingClaims: PendingClaimPreview[];
  status?: AnalysisStatus;
  chunksScanned?: number;
  lastScannedTimestamp?: number | null;
  currentScanPreview?: string | null;
  scanEntities?: string[];
  scanActionState?: ExtractionActionState | null;
  scanReason?: string | null;
  liveTimestampSeconds?: number | null;
  isPinned?: boolean;
  pinToTop?: () => void;
  onEntitySelect?: (entityLabel: string) => void;
  onRetryTranscript?: () => void;
}

const RAIL_TONE = {
  accent: panelTones.status.accent,
  soft: panelTones.status.accentSoft,
  supported: panelTones.status.supported,
  partial: panelTones.status.partial,
  disputed: panelTones.status.disputed,
  muted: panelTones.status.neutral,
} as const;

const VERDICT_META: Record<
  VerificationStatus,
  {
    label: string;
    tone: string;
    railTone: string;
  }
> = {
  supported: {
    label: 'Supported',
    tone: 'text-supported',
    railTone: RAIL_TONE.supported,
  },
  partial: {
    label: 'Mixed',
    tone: 'text-partial',
    railTone: RAIL_TONE.partial,
  },
  disputed: {
    label: 'Unsupported',
    tone: 'text-disputed',
    railTone: RAIL_TONE.disputed,
  },
  unverifiable: {
    label: 'Unresolved',
    tone: 'text-textMuted',
    railTone: RAIL_TONE.muted,
  },
};

const ENTITY_TERMS = new Set([
  'ai',
  'apple',
  'blizzard',
  'dopamine',
  'covid',
  'covid-19',
  'deepgram',
  'gemini',
  'google',
  'huberman',
  'jeff',
  'kaplan',
  'lex',
  'fridman',
  'mmo',
  'microsoft',
  'norepinephrine',
  'openai',
  'overwatch',
  'rogan',
  'rust',
  'scandinavia',
  'spotify',
  'titan',
  'warcraft',
  'whisper',
  'youtube',
]);

const ENTITY_PHRASES = [
  ['jeff', 'kaplan'],
  ['lex', 'fridman'],
  ['joe', 'rogan'],
  ['world', 'of', 'warcraft'],
  ['cold', 'water'],
  ['google', 'search'],
  ['european', 'journal', 'of', 'applied', 'physiology'],
] as const;

const NON_ENTITY_TITLECASE = new Set([
  'after',
  'before',
  'best',
  'current',
  'during',
  'from',
  'into',
  'more',
  'most',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'those',
  'what',
  'when',
  'where',
  'while',
  'why',
]);

const FEED_RAIL_LAYOUT = {
  '--rail-left': '46px',
  '--rail-node-left': '42px',
  '--rail-connector-left': '50px',
} as CSSProperties;

const MAX_HISTORY_ROWS = 20;
const HISTORY_ROW_TRANSITION = {
  duration: 0.3,
  ease: [0.16, 1, 0.3, 1] as const,
};

const NUMERIC_SIGNAL_PATTERN =
  /\b(\d+(?:\.\d+)?%?|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\b/i;
const TIME_SIGNAL_PATTERN =
  /\b(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years|decade|decades)\b/i;
const SOURCE_SIGNAL_PATTERN =
  /\b(according|study|studies|paper|research|report|reported|journal|published|authors?|data)\b/i;
const TIMELINE_SIGNAL_PATTERN =
  /\b(built|developed|released|launched|created|invented|founded|completed|finished|canceled|cancelled|started|ended|won|lost|died|killed)\b/i;
const CLAIM_VERB_PATTERN =
  /\b(is|was|were|are|has|have|had|did|does|caused|causes|led|leads|found|showed|shows|proved|proves|increased|decreased)\b/i;
const SUBJECTIVE_PATTERN =
  /\b(best|great|amazing|awful|terrible|good|bad|better|worse|favorite|fun|boring|toxic|cool)\b/i;
const BROAD_CONCEPT_PATTERN =
  /\b(toxicity|culture|design|leadership|matchmaking|heroes|community|identity|strategy|balance|philosophy)\b/i;

type ThoughtSignal = {
  entityHits: number;
  numeric: boolean;
  source: boolean;
  timeline: boolean;
  declarative: boolean;
  subjective: boolean;
  broadConcept: boolean;
  code: 'LIVE' | 'ENTITY' | 'NUM' | 'TIME' | 'SRC' | 'CLAIM';
  tone: 'hold' | 'live' | 'warm';
};

type ThoughtEntityMatch = {
  id: string;
  label: string;
  partIndexes: number[];
  contextSnippet: ContextSnippet | null;
};

type ThoughtReadout = {
  state: 'rejected' | 'context' | 'queued' | 'tracking';
  message: string;
};

const normalizeEntityToken = (value: string) =>
  value.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');

const normalizeEntityId = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const shouldHighlightEntity = (value: string) => {
  const rawToken = normalizeEntityToken(value);
  if (!rawToken) {
    return false;
  }

  const normalizedToken = rawToken.toLowerCase();
  if (ENTITY_TERMS.has(normalizedToken)) {
    return true;
  }

  if (/^[A-Z0-9]{2,6}$/.test(rawToken)) {
    return true;
  }

  // Prefer precision over recall in live reading mode: highlight mixed-case
  // tokens (e.g. PyTorch) but avoid generic sentence-start words ("Then").
  return (
    /^[A-Z][A-Za-z0-9'-]{3,}$/.test(rawToken) &&
    /[A-Z]/.test(rawToken.slice(1)) &&
    !NON_ENTITY_TITLECASE.has(normalizedToken)
  );
};

const extractThoughtEntities = (text: string, preferredLabels: string[] = []): ThoughtEntityMatch[] => {
  if (!text.trim()) {
    return [];
  }

  const parts = text.split(/(\s+)/);
  const words = parts
    .map((part, partIndex) => ({
      part,
      partIndex,
      normalized: normalizeEntityToken(part).toLowerCase(),
    }))
    .filter((entry) => entry.normalized.length > 0);
  const matchesById = new Map<string, ThoughtEntityMatch>();

  const upsertMatch = (rawLabel: string, partIndexes: number[]) => {
    const matchId = normalizeEntityId(rawLabel);
    if (!matchId) {
      return;
    }

    const contextSnippet = getContextForEntity(rawLabel);
    const existingMatch = matchesById.get(matchId);

    if (!existingMatch) {
      matchesById.set(matchId, {
        id: matchId,
        label: contextSnippet?.title.replace(/\s+\([^)]*\)/g, '') || rawLabel,
        partIndexes,
        contextSnippet,
      });
      return;
    }

    matchesById.set(matchId, {
      ...existingMatch,
      partIndexes: Array.from(new Set([...existingMatch.partIndexes, ...partIndexes])).sort((left, right) => left - right),
      contextSnippet: existingMatch.contextSnippet || contextSnippet,
    });
  };

  preferredLabels.forEach((label) => {
    const normalizedLabel = normalizeEntityId(label);
    if (!normalizedLabel) {
      return;
    }

    const labelTokens = normalizedLabel.split(' ');
    for (let index = 0; index < words.length; index += 1) {
      if (labelTokens.every((token, offset) => words[index + offset]?.normalized === token)) {
        const phraseWords = words.slice(index, index + labelTokens.length);
        const rawLabel = phraseWords
          .map((entry) => normalizeEntityToken(entry.part))
          .filter(Boolean)
          .join(' ');
        upsertMatch(rawLabel || label, phraseWords.map((entry) => entry.partIndex));
      }
    }

    const contextSnippet = getContextForEntity(label);
    if (contextSnippet && !matchesById.has(contextSnippet.id)) {
      matchesById.set(contextSnippet.id, {
        id: contextSnippet.id,
        label: contextSnippet.title.replace(/\s+\([^)]*\)/g, ''),
        partIndexes: [],
        contextSnippet,
      });
    }
  });

  for (let index = 0; index < words.length; index += 1) {
    const phraseMatch = ENTITY_PHRASES.find((phrase) =>
      phrase.every((token, offset) => words[index + offset]?.normalized === token)
    );

    if (phraseMatch) {
      const phraseWords = words.slice(index, index + phraseMatch.length);
      const rawLabel = phraseWords
        .map((entry) => normalizeEntityToken(entry.part))
        .filter(Boolean)
        .join(' ');

      upsertMatch(rawLabel, phraseWords.map((entry) => entry.partIndex));
      index += phraseMatch.length - 1;
      continue;
    }

    if (shouldHighlightEntity(words[index].part)) {
      upsertMatch(normalizeEntityToken(words[index].part), [words[index].partIndex]);
    }
  }

  return Array.from(matchesById.values());
};

const getThoughtSignal = (text: string, entityHits: number): ThoughtSignal => {
  const numeric = NUMERIC_SIGNAL_PATTERN.test(text) || TIME_SIGNAL_PATTERN.test(text);
  const source = SOURCE_SIGNAL_PATTERN.test(text);
  const timeline = TIMELINE_SIGNAL_PATTERN.test(text);
  const declarative = CLAIM_VERB_PATTERN.test(text);
  const subjective = SUBJECTIVE_PATTERN.test(text);
  const broadConcept = BROAD_CONCEPT_PATTERN.test(text);

  if (source) {
    return { entityHits, numeric, source, timeline, declarative, subjective, broadConcept, code: 'SRC', tone: 'warm' };
  }

  if (numeric && timeline) {
    return { entityHits, numeric, source, timeline, declarative, subjective, broadConcept, code: 'CLAIM', tone: 'warm' };
  }

  if (numeric) {
    return { entityHits, numeric, source, timeline, declarative, subjective, broadConcept, code: 'NUM', tone: 'warm' };
  }

  if (timeline) {
    return { entityHits, numeric, source, timeline, declarative, subjective, broadConcept, code: 'TIME', tone: 'live' };
  }

  if (entityHits > 0) {
    return { entityHits, numeric, source, timeline, declarative, subjective, broadConcept, code: 'ENTITY', tone: 'live' };
  }

  if (declarative) {
    return { entityHits, numeric, source, timeline, declarative, subjective, broadConcept, code: 'CLAIM', tone: 'live' };
  }

  return { entityHits, numeric, source, timeline, declarative, subjective, broadConcept, code: 'LIVE', tone: 'hold' };
};

const renderThoughtTokens = (
  text: string,
  entities: ThoughtEntityMatch[],
  onEntitySelect?: (entityLabel: string) => void
) => {
  const parts = text.split(/(\s+)/);
  const partIndexToEntity = new Map<number, ThoughtEntityMatch>();
  entities.forEach((entity) => {
    entity.partIndexes.forEach((partIndex) => {
      partIndexToEntity.set(partIndex, entity);
    });
  });

  return parts.map((part, index) => (
    partIndexToEntity.has(index) ? (
      <button
        key={`${part}-${index}`}
        type="button"
        className="reading-entity"
        onClick={() => onEntitySelect?.(partIndexToEntity.get(index)?.label || normalizeEntityToken(part))}
        title={`Ask about ${partIndexToEntity.get(index)?.label || normalizeEntityToken(part)}`}
      >
        {part}
      </button>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  ));
};

const getReadingHudState = (
  textLength: number,
  wordCount: number,
  frame: number,
  secondary: boolean,
  signal: ThoughtSignal
) => {
  const tokenEstimate = String(
    Math.min(99, Math.max(7, Math.round(textLength / 3.7) + (frame % 5)))
  ).padStart(2, '0');

  if (secondary) {
    return {
      label: '[REC]',
      tone: 'live' as const,
    };
  }

  if (wordCount === 0) {
    return frame % 2 === 0
      ? { label: '[REC]', tone: 'hold' as const }
      : { label: '[TOK:00]', tone: 'hold' as const };
  }

  switch (frame % 3) {
    case 0:
      return { label: `[TOK:${tokenEstimate}]`, tone: signal.tone };
    case 1:
      return { label: `[SIG:${signal.code}]`, tone: signal.tone };
    default:
      return { label: '[REC]', tone: signal.code === 'LIVE' ? 'hold' as const : signal.tone };
  }
};

const getThoughtReadout = (
  wordCount: number,
  signal: ThoughtSignal,
  entities: ThoughtEntityMatch[]
): ThoughtReadout => {
  const hasContextSnippet = entities.some((entity) => entity.contextSnippet);

  if (wordCount === 0) {
    return {
      state: 'tracking',
      message: 'Listening for a checkable claim.',
    };
  }

  if (wordCount < 5) {
    return {
      state: 'rejected',
      message: 'Incomplete phrase.',
    };
  }

  if (signal.source) {
    return {
      state: signal.declarative ? 'tracking' : 'rejected',
      message: signal.declarative
        ? 'Source detected. Watching this line.'
        : 'Source detected. No claim yet.',
    };
  }

  if (signal.numeric && signal.timeline) {
    return {
      state: 'queued',
      message: 'Timeline detected. Queuing check…',
    };
  }

  if (signal.numeric) {
    return {
      state: 'tracking',
      message: 'Numeric data. Waiting for context.',
    };
  }

  if (signal.timeline) {
    return {
      state: signal.declarative ? 'tracking' : 'rejected',
      message: signal.declarative
        ? 'Timeline detected. Watching this line.'
        : 'Timeline fragment. No outcome yet.',
    };
  }

  if (signal.subjective && !signal.declarative) {
    return {
      state: 'rejected',
      message: 'Opinion detected. Waiting for a factual claim.',
    };
  }

  if (signal.broadConcept && !signal.declarative) {
    return {
      state: 'rejected',
      message: 'General commentary. No checkable claim yet.',
    };
  }

  if (hasContextSnippet) {
    return {
      state: 'context',
      message: 'Entity detected. Context available.',
    };
  }

  if (entities.length > 0) {
    return {
      state: 'tracking',
      message: 'Named terms detected. Waiting for a concrete claim.',
    };
  }

  if (!signal.declarative) {
    return {
      state: 'rejected',
      message: 'No checkable claim yet.',
    };
  }

  return {
    state: 'tracking',
    message: 'Scanning for a checkable claim.',
  };
};

/* ── Rail layout ── */

const RailEntry = ({
  timestampSeconds,
  tone,
  glow = false,
  children,
}: {
  timestampSeconds: number | null;
  tone: string;
  glow?: boolean;
  children: ReactNode;
}) => (
  <div className="relative pl-[76px]">
    {timestampSeconds !== null && (
      <div className="absolute left-0 top-[14px] w-[36px] pr-1 text-right">
        <span className="rail-timestamp font-mono text-[10px] font-medium tracking-[0.05em]">
          {formatTime(timestampSeconds)}
        </span>
      </div>
    )}
    <span
      className={`rail-node${glow ? ' rail-node-live' : ''}`}
      style={{ background: tone, boxShadow: `0 0 0 4px ${tone}20` }}
    />
    <span
      className="rail-connector"
      style={{ background: `linear-gradient(90deg, ${tone}, rgba(0, 0, 0, 0))` }}
    />
    {children}
  </div>
);

const SkeletonCard = () => (
  <RailEntry timestampSeconds={null} tone={RAIL_TONE.muted}>
    <div className="feed-card ml-1 px-4 py-4">
      <div className="skeleton h-4 w-16" />
      <div className="mt-3 skeleton h-4 w-full" />
      <div className="mt-2 skeleton h-4 w-4/5" />
    </div>
  </RailEntry>
);

/* ── Truncate transcript to last ~60 chars, clean filler ── */

const cleanPreview = (raw: string): string => {
  const normalizeWord = (value: string | undefined) =>
    value?.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '') ?? '';

  // Strip inline timestamps like "51 minutes, 26 seconds" or "1:23:45"
  let cleaned = raw.replace(/\d+\s*(minutes?|seconds?|hours?),?\s*/gi, '');
  cleaned = cleaned.replace(/\d{1,2}:\d{2}(:\d{2})?\s*/g, '');
  // Strip filler words
  cleaned = cleaned.replace(/\b(uh|um|you know|sort of|kind of|I mean)\b/gi, '');
  // Collapse whitespace and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  // Deduplicate repeated 2-4 word phrases caused by overlapping transcript chunks.
  const words = cleaned.split(' ');
  const uniqueWords: string[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const currentWord = normalizeWord(words[index]);
    const nextWord = normalizeWord(words[index + 1]);
    const nextNextWord = normalizeWord(words[index + 2]);
    const nextThirdWord = normalizeWord(words[index + 3]);
    const previousWord = normalizeWord(uniqueWords[uniqueWords.length - 1]);
    const previousTwoWords = normalizeWord(uniqueWords[uniqueWords.length - 2]);
    const previousThreeWords = normalizeWord(uniqueWords[uniqueWords.length - 3]);
    const previousFourWords = normalizeWord(uniqueWords[uniqueWords.length - 4]);

    if (
      currentWord &&
      currentWord === previousFourWords &&
      nextWord === previousThreeWords &&
      nextNextWord === previousTwoWords &&
      nextThirdWord === previousWord
    ) {
      index += 3;
      continue;
    }

    if (
      currentWord &&
      currentWord === previousThreeWords &&
      nextWord === previousTwoWords &&
      nextNextWord === previousWord
    ) {
      index += 2;
      continue;
    }

    if (
      currentWord &&
      currentWord === previousTwoWords &&
      nextWord === previousWord
    ) {
      index += 1;
      continue;
    }

    if (currentWord && currentWord === previousWord) {
      continue;
    }

    uniqueWords.push(words[index]);
  }

  cleaned = uniqueWords.join(' ');
  // Prefer starting at a sentence boundary within the last ~180 chars.
  if (cleaned.length > 80) {
    const window = cleaned.slice(-180);
    const sentenceMatches = [...window.matchAll(/[.!?]\s+(?=[A-Z])/g)];
    if (sentenceMatches.length > 0) {
      const lastMatch = sentenceMatches[sentenceMatches.length - 1];
      const sentenceStart = window.slice((lastMatch.index ?? 0) + lastMatch[0].length);
      if (sentenceStart.split(/\s+/).filter(Boolean).length >= 5) {
        return sentenceStart;
      }
    }
    // Fall back to a larger tail and show an ellipsis when clipped.
    return `… ${cleaned.slice(-110).trim()}`;
  }
  return cleaned;
};

/* ── Live reading strip — compact activity indicator ── */

const LiveReadingStrip = ({
  timestampSeconds,
  previewText,
  secondary = false,
  showCursor = false,
  extractedEntities = [],
  actionState = null,
  reason = null,
  onEntitySelect,
}: {
  timestampSeconds: number | null;
  previewText: string;
  secondary?: boolean;
  showCursor?: boolean;
  extractedEntities?: string[];
  actionState?: ExtractionActionState | null;
  reason?: string | null;
  onEntitySelect?: (entityLabel: string) => void;
}) => {
  const cleaned = previewText ? cleanPreview(previewText) : '';
  const transcriptLine = cleaned || 'Listening…';
  const wordCount = cleaned ? cleaned.split(/\s+/).filter(Boolean).length : 0;
  const [hudFrame, setHudFrame] = useState(0);
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const thoughtEntities = useMemo(
    () => extractThoughtEntities(cleaned, extractedEntities),
    [cleaned, extractedEntities]
  );
  const thoughtSignal = useMemo(
    () => getThoughtSignal(cleaned, thoughtEntities.length),
    [cleaned, thoughtEntities.length]
  );
  const availableContextSnippets = useMemo(
    () => thoughtEntities
      .map((entity) => entity.contextSnippet)
      .filter((snippet): snippet is ContextSnippet => snippet !== null),
    [thoughtEntities]
  );
  const activeContextSnippet = useMemo(() => {
    if (selectedContextId) {
      return availableContextSnippets.find((snippet) => snippet.id === selectedContextId) ?? availableContextSnippets[0] ?? null;
    }

    return availableContextSnippets[0] ?? null;
  }, [availableContextSnippets, selectedContextId]);
  const thoughtReadout = useMemo(
    () => reason
      ? {
          state:
            actionState === 'VERIFYING'
              ? 'queued'
              : actionState === 'REJECTED'
                ? 'rejected'
                : 'tracking',
          message: reason,
        }
      : getThoughtReadout(wordCount, thoughtSignal, thoughtEntities),
    [wordCount, thoughtSignal, thoughtEntities, actionState, reason]
  );

  useEffect(() => {
    setHudFrame(0);
    const intervalId = window.setInterval(() => {
      setHudFrame((currentFrame) => (currentFrame + 1) % 36);
    }, 1400);

    return () => window.clearInterval(intervalId);
  }, [cleaned, secondary]);

  useEffect(() => {
    if (!availableContextSnippets.length) {
      setSelectedContextId(null);
      return;
    }

    setSelectedContextId((currentId) => (
      currentId && availableContextSnippets.some((snippet) => snippet.id === currentId)
        ? currentId
        : availableContextSnippets[0].id
    ));
  }, [availableContextSnippets]);

  const hudState = useMemo(
    () => getReadingHudState(cleaned.length, wordCount, hudFrame, secondary, thoughtSignal),
    [cleaned.length, wordCount, hudFrame, secondary, thoughtSignal]
  );
  const transcriptNodes = useMemo(
    () => (
      cleaned
        ? renderThoughtTokens(transcriptLine, thoughtEntities, (entityLabel) => {
            const matchedContext = getContextForEntity(entityLabel);
            if (matchedContext) {
              setSelectedContextId(matchedContext.id);
            }
            onEntitySelect?.(entityLabel);
          })
        : transcriptLine
    ),
    [cleaned, transcriptLine, thoughtEntities, onEntitySelect]
  );
  const showTranscriptCursor = showCursor && secondary;
  const showFooterCursor = showCursor;

  return (
    <RailEntry timestampSeconds={timestampSeconds} tone={RAIL_TONE.accent}>
      <div className={`reading-strip relative ml-1${secondary ? ' reading-strip-secondary' : ' reading-strip-primary'}`}>
        <div className="reading-strip-header">
          <div className="reading-kicker">
            <span className="reading-kicker-mark" aria-hidden="true" />
            <span>{secondary ? 'Reading now' : 'Live Transcript'}</span>
          </div>
          <div className="reading-meta" aria-hidden="true">
            <span className="reading-meta-dot" data-tone={hudState.tone} />
            {SHOW_DEBUG && <span className="reading-meta-label">{hudState.label}</span>}
          </div>
        </div>

        <p className="reading-transcript">
          {transcriptNodes}
          {showTranscriptCursor && <span className="typing-cursor" aria-hidden="true" />}
        </p>

        {activeContextSnippet && (
          <div className="reading-context">
            <div className="reading-context-meta">
              <span>{activeContextSnippet.category} detected</span>
              <span>{activeContextSnippet.category}</span>
            </div>
            <p className="reading-context-title">{activeContextSnippet.title}</p>
            <p className="reading-context-copy">{activeContextSnippet.description}</p>
          </div>
        )}

        <div className="reading-footer-shell">
          <p className="reading-footer-line" data-state={thoughtReadout.state}>
            <span className="reading-terminal-prefix" aria-hidden="true">
              &gt;
            </span>
            <span>{thoughtReadout.message}</span>
            {showFooterCursor && <span className="typing-cursor" aria-hidden="true" />}
          </p>
        </div>
      </div>
    </RailEntry>
  );
};

/* ── Checking card ── */

const LiveCheckingCard = ({
  timestampSeconds,
  claimText,
}: {
  timestampSeconds: number | null;
  claimText: string;
}) => (
  <RailEntry timestampSeconds={timestampSeconds} tone={RAIL_TONE.soft} glow>
    <div className="feed-card feed-card-checking relative ml-1 px-4 py-4 card-enter">
      <div className="investigation-sweep" />

      <div className="status-badge text-accentSoft status-badge-live">Checking</div>

      <p className="mt-3 text-[17px] font-semibold leading-[1.42] tracking-[-0.016em] text-textMain">
        {claimText}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <span className="flex items-center gap-[3px]">
          {[0, 160, 320].map((delay) => (
            <span
              key={delay}
              className="block h-[3px] w-[3px] rounded-full bg-accentSoft animate-dotBounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="text-[11.5px] text-accentSoft/80">
          Checking that claim
        </span>
      </div>
    </div>
  </RailEntry>
);

/* ── Static state card ── */

const StateCard = ({
  badgeLabel,
  badgeTone,
  timestampSeconds,
  tone,
  headline,
  supportLine,
  actionLabel,
  onAction,
}: {
  badgeLabel: string;
  badgeTone: string;
  timestampSeconds: number | null;
  tone: string;
  headline: string;
  supportLine: string;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <RailEntry timestampSeconds={timestampSeconds} tone={tone}>
    <div className="feed-card state-card ml-1 px-4 py-4">
      <div className={`status-badge ${badgeTone}`}>{badgeLabel}</div>
      <p className="state-card-title mt-3 text-[16px] font-semibold leading-[1.4] tracking-[-0.014em] text-textMain">
        {headline}
      </p>
      <p className="state-card-copy mt-2 text-[12px] leading-[1.5] text-textMain/80">{supportLine}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="state-card-action mt-4 rounded border border-accentSoft/40 px-3 py-2 text-[11px] font-medium text-accentSoft transition-colors hover:border-accentSoft/70 hover:text-textMain"
        >
          {actionLabel}
        </button>
      )}
    </div>
  </RailEntry>
);

/* ── Checked claim row ── */

const CheckedClaimRow = ({
  card,
  isExpanded,
  onToggle,
}: {
  card: SourceCard;
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const prefersReducedMotion = useReducedMotion();
  const verdictMeta = VERDICT_META[card.status];
  const detailId = `checked-claim-${card.id}`;
  const supportLine = card.sourceTitle?.trim()
    ? card.sourceTitle.trim()
    : 'No web source found.';
  const nuanceLine = card.nuance?.trim();
  const transition = prefersReducedMotion
    ? { duration: 0 }
    : HISTORY_ROW_TRANSITION;

  return (
    <motion.div
      layout
      className="relative"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
    >
      <RailEntry timestampSeconds={card.timestampSeconds} tone={verdictMeta.railTone}>
        <div className={`history-entry ml-1${isExpanded ? ' history-entry-expanded' : ''}`}>
          <span
            className="history-entry-accent"
            aria-hidden="true"
            style={{ background: verdictMeta.railTone }}
          />

          <button
            type="button"
            className="history-row"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-controls={detailId}
          >
            <span className={`verdict-chip ${verdictMeta.tone}`}>{verdictMeta.label}</span>
            <p
              className="history-claim-text min-w-0 flex-1 text-[13px] leading-[1.45] text-textMain/92"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {card.nuance?.trim() || card.claim.claimText}
            </p>
          </button>

          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                id={detailId}
                className="history-detail"
                initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={transition}
              >
                <div className="history-detail-inner pb-2 pt-1">
                  <div className="history-detail-panel">
                    <div className="history-detail-line">
                      <span className="history-detail-label">Best source found</span>
                      {card.sourceUrl && card.sourceTitle?.trim() ? (
                        <a
                          href={card.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="history-detail-link"
                        >
                          {supportLine}
                        </a>
                      ) : (
                        <p className="history-detail-copy">{supportLine}</p>
                      )}
                    </div>

                    {nuanceLine && (
                      <p className="history-detail-note">{nuanceLine}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </RailEntry>
    </motion.div>
  );
};

/* ── Main feed ── */

export const CardFeed = ({
  askHistory = [],
  cards,
  pendingClaims,
  status = 'idle',
  chunksScanned = 0,
  lastScannedTimestamp = null,
  currentScanPreview = null,
  scanEntities = [],
  scanActionState = null,
  scanReason = null,
  liveTimestampSeconds = null,
  isPinned = true,
  pinToTop,
  onEntitySelect,
  onRetryTranscript,
}: CardFeedProps) => {
  const prefersReducedMotion = useReducedMotion();
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const isInitialLoading =
    status === 'loading' &&
    cards.length === 0 &&
    pendingClaims.length === 0 &&
    chunksScanned === 0;

  const latestCheckedCard = cards[0] ?? null;
  const olderCards = cards.length > 1 ? cards.slice(1, MAX_HISTORY_ROWS + 1) : [];
  const latestPendingClaim = pendingClaims[0] ?? null;
  const checkingTimestamp = latestPendingClaim?.timestampSeconds ?? lastScannedTimestamp;
  const activePreview = latestPendingClaim?.claimText?.trim() || currentScanPreview?.trim() || '';
  const activeReadingTimestamp = lastScannedTimestamp ?? liveTimestampSeconds;
  const isLiveReading = status === 'monitoring' || status === 'ready' || status === 'verifying';
  const showTypingCursor = status !== 'idle' && status !== 'error' && status !== 'no-transcript';

  const showReadingState =
    !latestCheckedCard &&
    !latestPendingClaim &&
    isLiveReading &&
    (chunksScanned > 0 || lastScannedTimestamp !== null || Boolean(currentScanPreview));

  const showResumeLive =
    !isPinned &&
    isLiveReading &&
    (cards.length > 0 || pendingClaims.length > 0 || Boolean(currentScanPreview));

  useEffect(() => {
    if (!expandedClaimId) {
      return;
    }

    if (!olderCards.some((card) => card.id === expandedClaimId)) {
      setExpandedClaimId(null);
    }
  }, [expandedClaimId, olderCards]);

  return (
    <div className="relative">
      <div
        className="relative flex flex-col gap-3 px-3 pb-4 pt-2"
        style={FEED_RAIL_LAYOUT}
      >
        <div className="signal-rail" />

        {isInitialLoading ? (
          <SkeletonCard />
        ) : (
          <>
            {/* Primary: reading strip when nothing else to show */}
            {showReadingState && !latestCheckedCard && !latestPendingClaim && (
              <LiveReadingStrip
                timestampSeconds={activeReadingTimestamp}
                previewText={activePreview}
                showCursor={showTypingCursor}
                extractedEntities={scanEntities}
                actionState={scanActionState}
                reason={scanReason}
                onEntitySelect={onEntitySelect}
              />
            )}

            {/* Hero: latest checked result */}
            <AnimatePresence mode="popLayout">
              {latestCheckedCard && (
                <motion.div
                  key={latestCheckedCard.id}
                  layout
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8, scale: 0.97 }}
                  transition={HISTORY_ROW_TRANSITION}
                >
                  <RailEntry timestampSeconds={latestCheckedCard.timestampSeconds} tone={VERDICT_META[latestCheckedCard.status].railTone}>
                    <LiveResultCard {...latestCheckedCard} isLatest />
                  </RailEntry>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pending check */}
            <AnimatePresence mode="popLayout">
              {latestPendingClaim && (
                <motion.div
                  key={latestPendingClaim.id}
                  layout
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                >
                  <LiveCheckingCard
                    timestampSeconds={checkingTimestamp}
                    claimText={latestPendingClaim.claimText || 'Checking that claim…'}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* No-transcript / error / idle states */}
            {!latestCheckedCard && !latestPendingClaim && !showReadingState && (
              status === 'no-transcript' ? (
                <StateCard
                  badgeLabel="Transcript unavailable"
                  badgeTone="text-partial"
                  timestampSeconds={null}
                  tone={RAIL_TONE.partial}
                  headline="Transcript unavailable"
                  supportLine="No usable captions were returned for this video."
                  actionLabel="Retry transcript"
                  onAction={onRetryTranscript}
                />
              ) : status === 'error' ? (
                <StateCard
                  badgeLabel="Error"
                  badgeTone="text-disputed"
                  timestampSeconds={null}
                  tone={RAIL_TONE.disputed}
                  headline="Something went wrong."
                  supportLine="Refresh the YouTube tab to try again."
                />
              ) : (
                <StateCard
                  badgeLabel={status === 'loading' ? 'Loading' : 'Idle'}
                  badgeTone={status === 'loading' ? 'text-accentSoft' : 'text-textMuted'}
                  timestampSeconds={null}
                  tone={status === 'loading' ? RAIL_TONE.soft : RAIL_TONE.muted}
                  headline={status === 'loading' ? 'Loading transcript…' : 'Waiting for video.'}
                  supportLine={
                    status === 'loading'
                      ? 'Fetching captions.'
                      : 'Open a captioned video to begin.'
                  }
                />
              )
            )}

            {/* Older checked claims */}
            {olderCards.length > 0 && (
              <motion.div layout className="flex flex-col">
                <motion.div layout className="pl-[76px]">
                  <div className="ml-1">
                    <p className="feed-section-label">Checked so far</p>
                  </div>
                </motion.div>
                {olderCards.map((card) => (
                  <CheckedClaimRow
                    key={`h-${card.id}`}
                    card={card}
                    isExpanded={expandedClaimId === card.id}
                    onToggle={() => {
                      setExpandedClaimId((current) => (current === card.id ? null : card.id));
                    }}
                  />
                ))}
              </motion.div>
            )}

            {askHistory.length > 0 && (
              <motion.div layout className="flex flex-col gap-2">
                <motion.div layout className="pl-[76px]">
                  <div className="ml-1">
                    <p className="feed-section-label feed-section-label-qa">Q&A History</p>
                  </div>
                </motion.div>
                {askHistory.map((entry, index) => (
                  <AskResponseCard
                    key={`${entry.query}-${entry.timestampSeconds}-${index}`}
                    query={entry.query}
                    answer={entry.answer}
                    timestampSeconds={entry.timestampSeconds}
                    sources={entry.sources}
                  />
                ))}
              </motion.div>
            )}

          </>
        )}
      </div>

      {showResumeLive && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <button
            type="button"
            onClick={() => pinToTop?.()}
            className="resume-live-btn pointer-events-auto"
          >
            <span className="block h-[7px] w-[7px] rotate-45 bg-accentSoft/80" />
            <span>Resume Live</span>
          </button>
        </div>
      )}
    </div>
  );
};
