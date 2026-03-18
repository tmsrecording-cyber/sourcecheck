import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

const SHOW_DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';
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
  selectedModel?: string;
  activeTab?: 'live' | 'history';
}

const RAIL_STYLE = {
  accent: { 
    from: 'from-sc-accent', 
    node: 'bg-sc-accent shadow-[0_0_0_4px_rgba(200,163,106,0.18)]' 
  },
  soft: { 
    from: 'from-sc-accent-soft', 
    node: 'bg-sc-accent-soft shadow-[0_0_0_4px_rgba(231,210,173,0.18)]' 
  },
  supported: { 
    from: 'from-sc-supported', 
    node: 'bg-sc-supported shadow-[0_0_0_4px_rgba(137,176,134,0.18)]' 
  },
  partial: { 
    from: 'from-sc-partial', 
    node: 'bg-sc-partial shadow-[0_0_0_4px_rgba(196,143,83,0.18)]' 
  },
  disputed: { 
    from: 'from-sc-disputed', 
    node: 'bg-sc-disputed shadow-[0_0_0_4px_rgba(198,111,93,0.18)]' 
  },
  muted: { 
    from: 'from-sc-neutral', 
    node: 'bg-sc-neutral shadow-[0_0_0_4px_rgba(122,109,95,0.18)]' 
  },
} as const;

const VERDICT_META: Record<
  VerificationStatus,
  {
    label: string;
    tone: string;
    railStyle: { from: string; node: string };
  }
> = {
  supported: {
    label: 'Supported',
    tone: 'text-sc-supported',
    railStyle: RAIL_STYLE.supported,
  },
  partial: {
    label: 'Mixed',
    tone: 'text-sc-partial',
    railStyle: RAIL_STYLE.partial,
  },
  disputed: {
    label: 'Unsupported',
    tone: 'text-sc-disputed',
    railStyle: RAIL_STYLE.disputed,
  },
  unverifiable: {
    label: 'Unresolved',
    tone: 'text-sc-muted',
    railStyle: RAIL_STYLE.muted,
  },
};

// Refined unverifiable labels based on sourceTitle/nuance signal
// Maps sourceTitle patterns to user-facing clarifying labels
type UnverifiableVariant = 'checking' | 'needs-context' | 'inconclusive';

const getUnverifiableLabel = (sourceTitle?: string, nuance?: string): string => {
  const text = `${sourceTitle || ''} ${nuance || ''}`.toLowerCase();
  
  // "Checking" — actively being processed or network/server issues
  if (text.includes('check') || text.includes('retry') || text.includes('temporarily') || 
      text.includes('rate limit') || text.includes('waiting')) {
    return 'Checking';
  }
  
  // "Needs context" — missing timeframe, population, or specifics
  if (text.includes('context') || text.includes('specifics') || text.includes('details') ||
      text.includes('timeframe') || text.includes('definition') || text.includes('unclear')) {
    return 'Needs context';
  }
  
  // Default: "Inconclusive" — couldn't verify but not due to missing context
  return 'Inconclusive';
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

// NEW FIX: Ignore common capitalized sentence starters from transcripts
const IGNORED_TITLE_CASE = new Set([
  'And', 'But', 'Or', 'So', 'The', 'A', 'An', 'In', 'On', 'At', 'To', 'For', 'With',
  'If', 'Then', 'When', 'Because', 'As', 'That', 'This', 'These', 'Those', 
  'It', 'Is', 'Are', 'Was', 'Were', 'Will', 'Would', 'Can', 'Could', 'Should', 
  'We', 'They', 'He', 'She', 'I', 'You', 'What', 'Where', 'Why', 'How', 'Yeah', 'Yes', 'No'
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

// TRUE Transformer hinge animation - cards fold down from top like a hinge
const transformerVariants = {
  initial: { 
    opacity: 0, 
    rotateX: -85,
    y: -20, 
    transformPerspective: 1200, 
    transformOrigin: "top center" as const
  },
  animate: { 
    opacity: 1, 
    rotateX: 0, 
    y: 0,
    transition: { 
      type: "spring" as const, 
      stiffness: 280, 
      damping: 22, 
      mass: 0.8 
    }
  },
  exit: { 
    opacity: 0, 
    rotateX: 60, 
    scale: 0.9, 
    transformOrigin: "bottom center" as const,
    transition: { duration: 0.25, ease: "easeIn" as const }
  }
};

const TRANSFORMER_TRANSITION = {
  type: "spring" as const,
  stiffness: 280,
  damping: 22,
  mass: 0.8
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

  // Acronyms (e.g. AI, MMO, FDA)
  if (/^[A-Z0-9]{2,6}$/.test(rawToken)) {
    return true;
  }

  // FIX: If word is ALL CAPS and longer than 6 chars, it's shouting
  // from YouTube captions, not a real entity
  if (rawToken === rawToken.toUpperCase() && rawToken.length > 6) {
    return false;
  }

  // NEW FIX: Ignore common capitalized sentence starters from transcripts
  if (IGNORED_TITLE_CASE.has(rawToken)) return false;

  // Proper Noun detection (Title Case like "Elon", "Microsoft")
  return (
    /^[A-Z][a-z0-9'-]{2,}$/.test(rawToken) &&
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
  style,
  glow = false,
  children,
}: {
  timestampSeconds: number | null;
  style: { from: string; node: string };
  glow?: boolean;
  children: ReactNode;
}) => (
  <div className="relative pl-[72px]">
    {/* Continuous timeline rail - extends full height for visual continuity */}
    <span 
      className="absolute left-[53px] top-0 bottom-0 w-[1px] opacity-30"
      style={{
        background: `linear-gradient(180deg, transparent 0%, rgba(var(--model-accent-rgb, 168, 199, 250), 0.4) 8%, rgba(var(--model-accent-rgb, 168, 199, 250), 0.25) 50%, rgba(var(--model-accent-rgb, 168, 199, 250), 0.1) 92%, transparent 100%)`,
      }}
    />
    {timestampSeconds !== null && (
      <div className="absolute left-0 top-[13px] w-[38px] pr-1.5 text-right">
        <span className="rail-timestamp font-mono text-[10.5px] font-semibold tracking-[0.04em] text-sc-text-soft/90">
          {formatTime(timestampSeconds)}
        </span>
      </div>
    )}
    {/* Phase 3: Diamond Node - Centered alignment for 1:42 position */}
    <span
      className={`rail-node absolute h-[7px] w-[7px] left-[50px] rotate-45 z-10 transition-all duration-300 border bg-sc-bg-0 ${style.node} ${glow ? 'animate-rail-node-pulse' : ''}`}
      style={{ 
        top: '11px',
        borderColor: `rgba(var(--model-accent-rgb, 168, 199, 250), 0.5)`,
        boxShadow: '0 0 8px rgba(var(--model-accent-rgb, 168, 199, 250), 0.35), inset 0 0 2px rgba(255, 255, 255, 0.5)'
      }}
    />
    {/* Phase 2: Razor-thin Fiber Optic Connector - fades before card */}
    <span
      className="rail-connector absolute h-[1px] w-[15px] left-[57px] opacity-80 transition-all duration-300"
      style={{ 
        top: '14px',
        background: `linear-gradient(to right, rgba(var(--model-accent-rgb, 168, 199, 250), 0.85), rgba(var(--model-accent-rgb, 168, 199, 250), 0.25) 80%, transparent)`
      }}
    />
    {children}
  </div>
);

const SkeletonCard = () => (
  <RailEntry timestampSeconds={null} style={RAIL_STYLE.muted}>
    <div className="feed-card ml-1 px-4 py-4 border border-sc-border-soft bg-sc-surface-0 shadow-sc-soft opacity-40">
      <div className="skeleton animate-pulse bg-sc-surface-2 h-4 w-16 rounded" />
      <div className="mt-3 skeleton animate-pulse bg-sc-surface-2 h-4 w-full rounded" />
      <div className="mt-2 skeleton animate-pulse bg-sc-surface-2 h-4 w-4/5 rounded" />
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
    <RailEntry timestampSeconds={timestampSeconds} style={RAIL_STYLE.accent}>
      <div className={`reading-strip relative ml-2${secondary ? ' reading-strip-secondary' : ' reading-strip-primary'}`}>
        {/* HUD Active Scan Overlay */}
        {!secondary && <div className="active-scan-overlay" />}
        <div className="reading-strip-header">
          <div className="reading-kicker">
            <span className="reading-kicker-mark" aria-hidden="true" />
            <span className="font-mono text-[9px] font-bold tracking-[0.12em] uppercase opacity-70">
              {secondary ? 'Reading now' : 'Live Transcript'}
            </span>
          </div>
          <div className="reading-meta" aria-hidden="true">
            <span className="reading-meta-dot" data-tone={hudState.tone} />
            {SHOW_DEBUG && <span className="font-mono text-[9px] font-medium tracking-tight opacity-40">{hudState.label}</span>}
          </div>
        </div>

        <p className="reading-transcript">
          {transcriptNodes}
          {showTranscriptCursor && <span className="typing-cursor" aria-hidden="true" />}
        </p>

        {activeContextSnippet && (
          <div className="reading-context mt-4">
            <div className="reading-context-meta">
              <span className="font-mono text-[8px] font-bold tracking-widest uppercase opacity-40">{activeContextSnippet.category} detected</span>
              <span className="px-1.5 py-0.5 rounded-sm bg-accent/10 text-accent font-mono text-[7px] font-bold tracking-tighter uppercase">{activeContextSnippet.category}</span>
            </div>
            <p className="reading-context-title mt-2 leading-snug">{activeContextSnippet.title}</p>
            <p className="reading-context-copy mt-1.5 leading-relaxed opacity-80">{activeContextSnippet.description}</p>
          </div>
        )}

        <div className="reading-footer-shell mt-4">
          <p className="reading-footer-line font-mono text-[9px] font-medium tracking-wide" data-state={thoughtReadout.state}>
            <span className="reading-terminal-prefix opacity-50" aria-hidden="true">
              &gt;
            </span>
            <span className="ml-1.5">{thoughtReadout.message}</span>
            {showFooterCursor && <span className="typing-cursor ml-1" aria-hidden="true" />}
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
  <RailEntry timestampSeconds={timestampSeconds} style={RAIL_STYLE.soft} glow>
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
  <RailEntry timestampSeconds={timestampSeconds} style={RAIL_STYLE[tone as keyof typeof RAIL_STYLE] || RAIL_STYLE.muted}>
    <div className="feed-card state-card ml-1 px-4 py-4 relative overflow-hidden">
      <div
        className="absolute top-4 right-4 h-12 w-12 opacity-[0.03] pointer-events-none"
        style={{
          background: 'currentColor',
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          color: 'var(--sc-accent)',
        }}
      />
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

/* ── Status Icons ── */
const StatusIcon = ({ status }: { status: VerificationStatus }) => {
  const icons = {
    supported: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    partial: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 5H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    disputed: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M3 3L7 7M7 3L3 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    unverifiable: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="1" fill="currentColor"/>
      </svg>
    ),
  };

  const statusClass = {
    supported: 'status-icon-supported',
    partial: 'status-icon-partial',
    disputed: 'status-icon-disputed',
    unverifiable: 'status-icon-neutral',
  };

  return (
    <span className={`status-icon ${statusClass[status]}`}>
      {icons[status]}
    </span>
  );
};

/* ── Checked claim row with 3D fold ── */

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

  // 3D fold content variants
  const foldVariants = {
    hidden: {
      rotateX: -90,
      opacity: 0,
      transformOrigin: 'top center' as const,
      transformPerspective: 1200,
      height: 0,
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
      height: 'auto',
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
    <motion.div
      layout
      className="relative transformer-card"
      initial={prefersReducedMotion ? false : { opacity: 0, rotateX: 45, scale: 0.96, transformPerspective: 1000 }}
      animate={{ opacity: 1, rotateX: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <RailEntry timestampSeconds={card.timestampSeconds} style={verdictMeta.railStyle}>
        <div className={`history-entry ml-1${isExpanded ? ' history-entry-expanded' : ''}`}>
          <span
            className={`history-entry-accent ${verdictMeta.railStyle.node.split(' ')[0]}`}
            aria-hidden="true"
          />

          <button
            type="button"
            className="history-row focus-ring"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-controls={detailId}
          >
            <div className="flex items-center gap-2 shrink-0">
              <StatusIcon status={card.status} />
              <span className={`verdict-chip ${verdictMeta.tone}`}>{verdictMeta.label}</span>
            </div>
            <p
              className="history-claim-text min-w-0 flex-1 mx-3 text-[13px] leading-[1.4] text-textMain/90 font-ui"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {card.nuance?.trim() || card.claim.claimText}
            </p>
            <motion.div
              className="shrink-0 text-sc-muted/50"
              variants={chevronVariants}
              initial="collapsed"
              animate={isExpanded ? 'expanded' : 'collapsed'}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </motion.div>
          </button>

          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                id={detailId}
                className="history-detail fold-container"
                variants={foldVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                style={{ transformStyle: 'preserve-3d', overflow: 'hidden' }}
              >
                <div className="history-detail-inner pb-2 pt-1">
                  <div className="history-detail-panel">
                    <div className="history-detail-line">
                      <span className="history-detail-label font-mono">Best source found</span>
                      {card.sourceUrl && card.sourceTitle?.trim() ? (
                        <a
                          href={card.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="electric-hover history-detail-link"
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
  activeTab = 'live',
  selectedModel = 'gemini-3.1-flash-lite-preview',
}: CardFeedProps) => {
  const prefersReducedMotion = useReducedMotion();
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const isInitialLoading =
    status === 'loading' &&
    cards.length === 0 &&
    pendingClaims.length === 0 &&
    chunksScanned === 0;

  const latestCheckedCard = activeTab === 'live' ? (cards[0] ?? null) : null;
  const olderCards = activeTab === 'live' 
    ? (cards.length > 1 ? cards.slice(1, MAX_HISTORY_ROWS + 1) : [])
    : (cards.length > 0 ? cards.slice(0, MAX_HISTORY_ROWS + 1) : []);
  const latestPendingClaim = pendingClaims[0] ?? null;
  const checkingTimestamp = latestPendingClaim?.timestampSeconds ?? lastScannedTimestamp;
  const activePreview = latestPendingClaim?.claimText?.trim() || currentScanPreview?.trim() || '';
  const activeReadingTimestamp = lastScannedTimestamp ?? liveTimestampSeconds;
  const isLiveReading = status === 'monitoring' || status === 'ready' || status === 'verifying';
  const isAnalyzing = status === 'monitoring' || status === 'verifying' || status === 'loading';
  const showTypingCursor = status !== 'idle' && status !== 'error' && status !== 'no-transcript';

  // FIX: Always show reading state when monitoring/verifying/loading with no cards
  const showReadingState =
    !latestCheckedCard &&
    !latestPendingClaim &&
    isAnalyzing &&
    (chunksScanned > 0 || lastScannedTimestamp !== null || Boolean(currentScanPreview) || status === 'monitoring' || status === 'verifying');

  const showResumeLive =
    !isPinned &&
    isLiveReading &&
    activeTab === 'live' &&
    (cards.length > 0 || pendingClaims.length > 0 || Boolean(currentScanPreview));

  useEffect(() => {
    if (!expandedClaimId) {
      return;
    }

    if (!olderCards.some((card) => card.id === expandedClaimId)) {
      setExpandedClaimId(null);
    }
  }, [expandedClaimId, olderCards]);

  // Dynamic model accent color for HUD lighting
  const modelAccentRgb = selectedModel === 'gemini-3.1-flash-lite-preview' 
    ? '168, 199, 250' // Gemini Blue
    : '215, 174, 251'; // Gemini Purple

  return (
    <div className="relative" style={{ '--model-accent-rgb': modelAccentRgb } as CSSProperties}>
      <div
        className="relative flex flex-col gap-2.5 px-3 pb-3 pt-2"
        style={{ ...FEED_RAIL_LAYOUT, '--model-accent-rgb': modelAccentRgb } as CSSProperties}
      >
        <div className="signal-rail" />

        {isInitialLoading ? (
          <SkeletonCard />
        ) : (
          <>
            {/* Primary: reading strip when nothing else to show */}
            {activeTab === 'live' && showReadingState && !latestCheckedCard && !latestPendingClaim && (
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

            {/* Hero: latest checked result (LIVE tab only) */}
            {activeTab === 'live' && (
              <AnimatePresence mode="popLayout">
                {latestCheckedCard && (
                  <motion.div
                    key={latestCheckedCard.id}
                    layout
                    className="transformer-card"
                    initial={prefersReducedMotion ? false : transformerVariants.initial}
                    animate={transformerVariants.animate}
                    exit={prefersReducedMotion ? undefined : transformerVariants.exit}
                    transition={TRANSFORMER_TRANSITION}
                  >
                    <RailEntry timestampSeconds={latestCheckedCard.timestampSeconds} style={VERDICT_META[latestCheckedCard.status].railStyle}>
                      <LiveResultCard {...latestCheckedCard} isLatest />
                    </RailEntry>
                  </motion.div>
                )}
              </AnimatePresence>
            )}

            {/* Pending check */}
            <AnimatePresence mode="popLayout">
              {activeTab === 'live' && latestPendingClaim && (
                <motion.div
                  key={latestPendingClaim.id}
                  layout
                  className="transformer-card"
                  initial={prefersReducedMotion ? false : transformerVariants.initial}
                  animate={transformerVariants.animate}
                  exit={prefersReducedMotion ? undefined : transformerVariants.exit}
                  transition={{ ...TRANSFORMER_TRANSITION, duration: 0.45 }}
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
                  tone="partial"
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
                  tone="disputed"
                  headline="Something went wrong."
                  supportLine="Refresh the YouTube tab to try again."
                />
              ) : status === 'monitoring' || status === 'verifying' ? (
                // FIX: Never show Idle when monitoring/verifying - show scanning state instead
                <LiveReadingStrip
                  timestampSeconds={activeReadingTimestamp}
                  previewText={currentScanPreview || 'Scanning for claims…'}
                  showCursor={true}
                  extractedEntities={scanEntities}
                  actionState={scanActionState}
                  reason={scanReason || 'Listening for checkable claims.'}
                  onEntitySelect={onEntitySelect}
                />
              ) : (
                <StateCard
                  badgeLabel={status === 'loading' ? 'Loading' : 'Idle'}
                  badgeTone={status === 'loading' ? 'text-accentSoft' : 'text-textMuted'}
                  timestampSeconds={null}
                  tone={status === 'loading' ? 'soft' : 'muted'}
                  headline={status === 'loading' ? 'Loading transcript…' : 'Waiting for video.'}
                  supportLine={
                    status === 'loading'
                      ? 'Fetching captions.'
                      : 'Open a captioned video to begin.'
                  }
                />
              )
            )}

            {/* Checked claims list */}
            {olderCards.length > 0 && (
              <motion.div layout className="flex flex-col">
                <motion.div layout className="pl-[72px]">
                  <div className="ml-1">
                    <p className="feed-section-label">
                      {activeTab === 'history' ? 'All verified claims' : 'Checked so far'}
                    </p>
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

            {/* Empty history state */}
            {activeTab === 'history' && cards.length === 0 && askHistory.length === 0 && (
              <div className="pl-[72px] py-8">
                <p className="text-[12px] text-sc-muted/60 font-sc italic">No checked claims yet. Results will appear here as claims are verified.</p>
              </div>
            )}

            {/* Q&A History (HISTORY tab only) */}
            {activeTab === 'history' && askHistory.length > 0 && (
              <motion.div layout className="flex flex-col gap-2">
                <motion.div layout className="pl-[72px]">
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
