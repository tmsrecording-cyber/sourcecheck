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
import { buildModelCssVars } from '../styles/modelTheme';
import { formatTime } from '../utils/formatTime';
import { stripLegacyCachePrefix } from '../utils/trustCopy';

interface CardFeedProps {
  askHistory?: Array<{
    query: string;
    answer: string;
    timestampSeconds: number;
    sources: AskQuestionSource[];
  }>;
  cards: SourceCard[];
  /** Complete card history (unfiltered) for HISTORY tab */
  allCards?: SourceCard[];
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
    accentClass: 'bg-sc-accent',
    solid: 'var(--model-accent-solid)',
    rgb: 'var(--model-accent-rgb, 138, 180, 248)',
  },
  soft: {
    accentClass: 'bg-sc-accent',
    solid: 'var(--model-accent-solid)',
    rgb: 'var(--model-accent-rgb, 138, 180, 248)',
  },
  supported: {
    accentClass: 'bg-sc-supported',
    solid: 'var(--sc-supported)',
    rgb: 'var(--sc-supported-rgb)',
  },
  partial: {
    accentClass: 'bg-sc-partial',
    solid: 'var(--sc-partial)',
    rgb: 'var(--sc-partial-rgb)',
  },
  disputed: {
    accentClass: 'bg-sc-disputed',
    solid: 'var(--sc-disputed)',
    rgb: 'var(--sc-disputed-rgb)',
  },
  muted: {
    accentClass: 'bg-sc-neutral',
    solid: 'var(--sc-neutral)',
    rgb: 'var(--sc-neutral-rgb)',
  },
} as const;

const VERDICT_META: Record<
  VerificationStatus,
  {
    label: string;
    tone: string;
    railStyle: { accentClass: string; solid: string; rgb: string };
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

export type LiveStripMode = 'primary' | 'forming' | 'watching';

export type PromotedLiveHeroMode = 'none' | 'pending' | 'checked';

export const resolvePromotedLiveLayout = ({
  activeTab,
  hasCheckedCard,
  hasPendingClaim,
}: {
  activeTab: 'live' | 'history';
  hasCheckedCard: boolean;
  hasPendingClaim: boolean;
}): {
  heroMode: PromotedLiveHeroMode;
  olderCardsStartIndex: number;
} => {
  if (activeTab !== 'live') {
    return {
      heroMode: 'none',
      olderCardsStartIndex: 0,
    };
  }

  if (hasPendingClaim) {
    return {
      heroMode: 'pending',
      olderCardsStartIndex: 0,
    };
  }

  if (hasCheckedCard) {
    return {
      heroMode: 'checked',
      olderCardsStartIndex: 1,
    };
  }

  return {
    heroMode: 'none',
    olderCardsStartIndex: 0,
  };
};

const buildPromotedClaimKey = ({
  claimText,
  timestampSeconds,
}: {
  claimText: string;
  timestampSeconds: number;
}) => `${timestampSeconds}:${claimText.trim().toLowerCase()}`;

export const getLiveStripMode = ({
  activeTab,
  status,
  hasCheckedCard,
  hasPendingClaim,
  hasScanSignal,
}: {
  activeTab: 'live' | 'history';
  status: AnalysisStatus;
  hasCheckedCard: boolean;
  hasPendingClaim: boolean;
  hasScanSignal: boolean;
}): LiveStripMode | null => {
  if (activeTab !== 'live' || hasPendingClaim) {
    return null;
  }

  if (status === 'ready') {
    return 'watching';
  }

  if (status === 'monitoring' || status === 'verifying') {
    if (!hasScanSignal && !hasCheckedCard) {
      return null;
    }
    return hasCheckedCard ? 'forming' : 'primary';
  }

  if (status === 'loading' && !hasCheckedCard && hasScanSignal) {
    return 'primary';
  }

  return null;
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
      message: 'Listening for a claim worth turning into a note.',
    };
  }

  if (wordCount < 5) {
    return {
      state: 'rejected',
      message: 'Captions are arriving. Waiting for a complete line.',
    };
  }

  if (signal.source) {
    return {
      state: signal.declarative ? 'tracking' : 'rejected',
      message: signal.declarative
        ? 'Source-like language detected. Holding this line.'
        : 'Source-like language detected. No concrete claim yet.',
    };
  }

  if (signal.numeric && signal.timeline) {
    return {
      state: 'queued',
      message: 'A concrete timeline claim is forming. Queuing a note…',
    };
  }

  if (signal.numeric) {
    return {
      state: 'tracking',
      message: 'Numeric detail detected. Waiting for context.',
    };
  }

  if (signal.timeline) {
    return {
      state: signal.declarative ? 'tracking' : 'rejected',
      message: signal.declarative
        ? 'A timeline detail is worth watching here.'
        : 'Timeline fragment detected. No outcome yet.',
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
      message: 'General commentary. No concrete note yet.',
    };
  }

  if (hasContextSnippet) {
    return {
      state: 'context',
      message: 'Relevant context is available for this line.',
    };
  }

  if (entities.length > 0) {
    return {
      state: 'tracking',
      message: 'Named entities detected. Waiting for a concrete claim.',
    };
  }

  if (!signal.declarative) {
    return {
      state: 'rejected',
      message: 'No verifiable note yet.',
    };
  }

  return {
    state: 'tracking',
    message: 'Shaping the next verifiable note.',
  };
};

/* ── Rail layout ── */

const RailEntry = ({
  timestampSeconds,
  style,
  glow = false,
  isHistoryMode = false,
  children,
}: {
  timestampSeconds: number | null;
  style: { accentClass: string; solid: string; rgb: string };
  glow?: boolean;
  isHistoryMode?: boolean;
  children: ReactNode;
}) => (
  <div className={`relative ${isHistoryMode ? 'pl-0' : 'pl-[72px]'}`}>
    {!isHistoryMode && (
      <>
        {/* Continuous timeline rail - extends full height for visual continuity */}
        <span 
          className="absolute left-[53px] top-0 bottom-0 w-[1px] opacity-30"
          style={{
            background: `linear-gradient(180deg, transparent 0%, rgba(${style.rgb}, 0.38) 8%, rgba(${style.rgb}, 0.22) 50%, rgba(${style.rgb}, 0.08) 92%, transparent 100%)`,
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
          className={`rail-node absolute h-[7px] w-[7px] left-[50px] rotate-45 z-10 transition-all duration-300 border ${glow ? 'animate-rail-node-pulse' : ''}`}
          style={{ 
            top: '11px',
            backgroundColor: style.solid,
            borderColor: `rgba(${style.rgb}, ${glow ? '0.50' : '0.34'})`,
            boxShadow: glow
              ? `0 0 10px rgba(${style.rgb}, 0.30), inset 0 0 2px rgba(255, 255, 255, 0.45)`
              : `0 0 6px rgba(${style.rgb}, 0.18), inset 0 0 2px rgba(255, 255, 255, 0.30)`,
          }}
        />
        {/* Phase 2: Razor-thin Fiber Optic Connector - fades before card */}
        <span
          className="rail-connector absolute h-[1px] w-[15px] left-[57px] opacity-80 transition-all duration-300"
          style={{ 
            top: '14px',
            background: `linear-gradient(to right, rgba(${style.rgb}, 0.82), rgba(${style.rgb}, 0.22) 80%, transparent)`
          }}
        />
      </>
    )}
    {/* History mode: compact timestamp badge */}
    {isHistoryMode && timestampSeconds !== null && (
      <div className="history-timestamp-badge">
        {formatTime(timestampSeconds)}
      </div>
    )}
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
  mode,
  showCursor = false,
  extractedEntities = [],
  actionState = null,
  reason = null,
  onEntitySelect,
}: {
  timestampSeconds: number | null;
  previewText: string;
  mode: LiveStripMode;
  showCursor?: boolean;
  extractedEntities?: string[];
  actionState?: ExtractionActionState | null;
  reason?: string | null;
  onEntitySelect?: (entityLabel: string) => void;
}) => {
  const isPrimary = mode === 'primary';
  const isWatching = mode === 'watching';
  const isForming = mode === 'forming';
  const isCompact = !isPrimary;
  const cleaned = previewText ? cleanPreview(previewText) : '';
  // PHASE 1D.11 FIX: Only show placeholder when no real preview exists
  const hasRealPreview = Boolean(previewText?.trim());
  const wordCount = cleaned ? cleaned.split(/\s+/).filter(Boolean).length : 0;
  const isFragmentaryPreview = isPrimary && wordCount > 0 && wordCount < 5;
  const transcriptLine = isWatching
    ? (cleaned || 'Watching for the next checkable claim.')
    : isFragmentaryPreview
      ? 'Capturing a complete line…'
      : (cleaned || (hasRealPreview ? '' : 'Listening…'));
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
    () => {
      // PHASE 1D.11 FIX: Don't show placeholder reason when we have real transcript
      const hasContent = wordCount > 0;
      const isPlaceholderReason = reason === 'Listening for checkable claims.' || reason === 'Listening for a checkable claim.';
      if (reason && !(hasContent && isPlaceholderReason)) {
        return {
          state:
            actionState === 'VERIFYING'
              ? 'queued'
              : actionState === 'REJECTED'
                ? 'rejected'
                : 'tracking',
          message: reason,
        };
      }
      return getThoughtReadout(wordCount, thoughtSignal, thoughtEntities);
    },
    [wordCount, thoughtSignal, thoughtEntities, actionState, reason]
  );

  useEffect(() => {
    setHudFrame(0);
    const intervalId = window.setInterval(() => {
      setHudFrame((currentFrame) => (currentFrame + 1) % 36);
    }, 1400);

    return () => window.clearInterval(intervalId);
  }, [cleaned, mode]);

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
    () => getReadingHudState(cleaned.length, wordCount, hudFrame, isCompact, thoughtSignal),
    [cleaned.length, wordCount, hudFrame, isCompact, thoughtSignal]
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
  const showTranscriptCursor = showCursor && isForming;
  const showFooterCursor = showCursor && !isWatching;
  const compactThoughtMessage = useMemo(() => {
    if (isPrimary || isWatching) {
      return thoughtReadout.message;
    }

    const firstSentence = thoughtReadout.message.split('. ')[0]?.trim();
    if (firstSentence && firstSentence.length <= 84) {
      return firstSentence.endsWith('.') ? firstSentence : `${firstSentence}.`;
    }

    if (thoughtReadout.message.length <= 88) {
      return thoughtReadout.message;
    }

    return `${thoughtReadout.message.slice(0, 84).trim()}…`;
  }, [isPrimary, isWatching, thoughtReadout.message]);

  return (
    <RailEntry timestampSeconds={timestampSeconds} style={RAIL_STYLE.accent}>
      <div className={[
        'reading-strip relative ml-2',
        isPrimary ? 'reading-strip-primary' : '',
        isForming ? 'reading-strip-forming' : '',
        isWatching ? 'reading-strip-watching' : '',
      ].join(' ').trim()}>
        {/* HUD Active Scan Overlay */}
        {isPrimary && <div className="active-scan-overlay" />}
        <div className="reading-strip-header">
          <div className="reading-kicker">
            <span className="reading-kicker-mark" aria-hidden="true" />
            <span className="font-mono text-[9px] font-bold tracking-[0.12em] uppercase opacity-70">
              {isPrimary ? 'Live transcript' : isWatching ? 'Watching now' : 'Forming note'}
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
          isForming ? (
            <div className="reading-context reading-context-compact mt-3">
              <div className="reading-context-compact-row">
                <span
                  className="rounded-sm px-1.5 py-0.5 font-mono text-[7px] font-bold uppercase tracking-tighter"
                  style={{
                    backgroundColor: 'var(--model-accent-10)',
                    color: 'var(--model-accent-solid)',
                  }}
                >
                  {activeContextSnippet.category}
                </span>
                <p className="reading-context-compact-copy">
                  {activeContextSnippet.title}
                </p>
              </div>
            </div>
          ) : isPrimary ? (
            <div className="reading-context mt-4">
              <div className="reading-context-meta">
                <span className="font-mono text-[8px] font-bold tracking-widest uppercase opacity-40">{activeContextSnippet.category} detected</span>
                <span
                  className="rounded-sm px-1.5 py-0.5 font-mono text-[7px] font-bold uppercase tracking-tighter"
                  style={{
                    backgroundColor: 'var(--model-accent-10)',
                    color: 'var(--model-accent-solid)',
                  }}
                >
                  {activeContextSnippet.category}
                </span>
              </div>
              <p className="reading-context-title mt-2 leading-snug">{activeContextSnippet.title}</p>
              <p className="reading-context-copy mt-1.5 leading-relaxed opacity-80">{activeContextSnippet.description}</p>
            </div>
          ) : null
        )}

        {!isWatching && (
          <div className="reading-footer-shell mt-4">
            <p
              className={`reading-footer-line font-mono text-[9px] font-medium tracking-wide${isCompact ? ' reading-footer-line-secondary' : ''}`}
              data-state={thoughtReadout.state}
            >
              <span className="reading-terminal-prefix opacity-50" aria-hidden="true">
                &gt;
              </span>
              <span className={`ml-1.5${isCompact ? ' reading-footer-message-secondary' : ''}`}>{compactThoughtMessage}</span>
              {showFooterCursor && <span className="typing-cursor ml-1" aria-hidden="true" />}
            </p>
          </div>
        )}
      </div>
    </RailEntry>
  );
};

/* ── Checking card with Codex-style thinking visuals ── */

const LiveCheckingCard = ({
  timestampSeconds,
  claimText,
}: {
  timestampSeconds: number | null;
  claimText: string;
}) => {
  const [thoughtIndex, setThoughtIndex] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setThoughtIndex(i => (i + 1) % 4);
    }, 900);
    return () => clearInterval(interval);
  }, []);
  
  const thoughts = [
    'analyzing claim structure...',
    'searching web sources...', 
    'cross-referencing data...',
    'synthesizing findings...'
  ];
  const scanProgressStops = [18, 42, 68, 88];
  const scanProgress = scanProgressStops[thoughtIndex] ?? 18;

  return (
    <RailEntry timestampSeconds={timestampSeconds} style={RAIL_STYLE.soft} glow>
      <div className="feed-card feed-card-checking relative ml-1 px-4 py-4 card-enter">
        <div className="checking-scan-ribbon" aria-hidden="true" />

        {/* Status with pulse */}
        <div className="flex items-center gap-2">
          <span className="thinking-pulse-dot" />
          <span className="status-badge status-badge-live">Verifying</span>
        </div>

        {/* Claim text */}
        <p className="mt-3 text-[17px] font-semibold leading-[1.42] tracking-[-0.016em] text-textMain">
          {claimText}
        </p>

        {/* ── CODEX-STYLE THINKING STREAM ── */}
        <div className="thinking-stream mt-3">
          <div className="thinking-terminal">
            <span className="thinking-prompt">›</span>
            <span className="thinking-text">
              {thoughts[thoughtIndex]}
            </span>
          </div>
          <div className="thinking-scan-lane" aria-hidden="true">
            <div className="thinking-scan-track" />
            <div
              className="thinking-scan-fill"
              style={{ width: `${scanProgress}%` }}
            />
            <div
              className="thinking-scan-head"
              style={{ left: `${scanProgress}%` }}
            />
          </div>
          <p className="thinking-status-copy">
            Cross-checking public sources before surfacing a result.
          </p>
        </div>
      </div>
    </RailEntry>
  );
};

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
    <div className="feed-card state-card relative ml-1 overflow-hidden px-4 py-4">
      <div
        className="absolute top-4 right-4 h-12 w-12 opacity-[0.03] pointer-events-none"
        style={{
          background: 'currentColor',
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          color:
            tone === 'partial'
              ? 'var(--sc-partial)'
              : tone === 'disputed'
                ? 'var(--sc-disputed)'
                : tone === 'supported'
                  ? 'var(--sc-supported)'
                  : tone === 'soft'
                    ? 'var(--model-accent-solid)'
                    : 'var(--sc-neutral)',
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
          className="state-card-action mt-4 rounded border border-sc-border-soft px-3 py-2 text-[11px] font-medium text-sc-text-soft transition-colors hover:border-sc-border hover:text-sc-text"
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

/* ── Mechanical hinged card ── */

const CheckedClaimRow = ({
  card,
  isExpanded,
  onToggle,
  isHistoryMode = false,
  isLast = false,
  enableLayoutAnimation = false,
}: {
  card: SourceCard;
  isExpanded: boolean;
  onToggle: () => void;
  isHistoryMode?: boolean;
  isLast?: boolean;
  enableLayoutAnimation?: boolean;
}) => {
  const prefersReducedMotion = useReducedMotion();
  const verdictMeta = VERDICT_META[card.status];
  const detailId = `checked-claim-${card.id}`;
  const supportLine = card.sourceTitle?.trim()
    ? card.sourceTitle.trim()
    : 'No web source found.';
  const sanitizedNuance = stripLegacyCachePrefix(card.nuance);
  const nuanceLine = sanitizedNuance;

  // MECHANICAL FOLD: Spring-based with staged compression
  const foldVariants = {
    hidden: {
      rotateX: -95,
      opacity: 0,
      scaleY: 0.3,
      transformOrigin: 'top center' as const,
      transformPerspective: 1400,
      height: 0,
      y: -10,
      transition: {
        type: 'spring' as const,
        stiffness: 400,
        damping: 30,
        mass: 0.9,
        opacity: { duration: 0.15 },
      },
    },
    visible: {
      rotateX: 0,
      opacity: 1,
      scaleY: 1,
      transformOrigin: 'top center' as const,
      transformPerspective: 1400,
      height: 'auto',
      y: 0,
      transition: {
        type: 'spring' as const,
        stiffness: 320,
        damping: 26,
        mass: 0.8,
        opacity: { duration: 0.2, delay: 0.05 },
      },
    },
  };

  // Card compression when collapsed - feels like panels stacking
  const cardVariants = {
    collapsed: {
      scaleY: 1,
      y: 0,
      transition: {
        type: 'spring' as const,
        stiffness: 500,
        damping: 35,
      },
    },
    expanded: {
      scaleY: 1,
      y: 0,
      transition: {
        type: 'spring' as const,
        stiffness: 400,
        damping: 30,
      },
    },
  };

  const chevronVariants = {
    collapsed: { rotate: 0 },
    expanded: { rotate: 180 },
  };

  return (
    <motion.div
      layout={enableLayoutAnimation}
      className="relative mechanical-card"
      variants={cardVariants}
      animate={isExpanded ? 'expanded' : 'collapsed'}
      initial={prefersReducedMotion ? false : { opacity: 0, rotateX: 45, scale: 0.96, transformPerspective: 1000 }}
      whileHover={{ scale: 1.005, transition: { duration: 0.15 } }}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {/* Hinge line - visible mechanical joint */}
      <div className="mechanical-hinge" aria-hidden="true">
        <div className="hinge-pin" />
        <div className="hinge-socket" />
      </div>
      
      <RailEntry timestampSeconds={card.timestampSeconds} style={verdictMeta.railStyle} isHistoryMode={isHistoryMode}>
        <div className={`mechanical-entry ml-1${isExpanded ? ' mechanical-entry-expanded' : ''}${isHistoryMode ? ' mechanical-entry-history' : ''}${isLast && isHistoryMode ? ' mechanical-entry-last' : ''}`}>
          <span
            className={`mechanical-entry-accent ${verdictMeta.railStyle.accentClass}`}
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
              className={`history-claim-text min-w-0 flex-1 ${isHistoryMode ? '' : 'mx-3'} text-[13px] leading-[1.4] text-textMain/90 font-ui`}
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {sanitizedNuance || card.claim.claimText}
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

          {/* MECHANICAL FOLD: Layered compression with 3D hinge */}
          <AnimatePresence initial={false} mode="wait">
            {isExpanded && (
              <motion.div
                id={detailId}
                className="mechanical-fold"
                variants={foldVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                style={{ 
                  transformStyle: 'preserve-3d',
                  overflow: 'hidden',
                }}
              >
                {/* Compression shadow - visual depth cue */}
                <div className="fold-shadow-top" aria-hidden="true" />
                
                <div className="mechanical-fold-inner pb-2 pt-1">
                  <div className="mechanical-detail-panel">
                    <div className="mechanical-detail-line">
                      <span className="mechanical-detail-label font-mono">Best source found</span>
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
  allCards,
}: CardFeedProps) => {
  const prefersReducedMotion = useReducedMotion();
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const enableListLayoutAnimations = activeTab === 'history' && !prefersReducedMotion;
  const isInitialLoading =
    status === 'loading' &&
    cards.length === 0 &&
    pendingClaims.length === 0 &&
    chunksScanned === 0;

  // FIX: Use allCards (unfiltered) for HISTORY tab, cards (leash-filtered) for LIVE tab
  const displayCards = activeTab === 'history' && allCards ? allCards : cards;
  const latestCheckedCard = activeTab === 'live' ? (cards[0] ?? null) : null;
  const latestPendingClaim = pendingClaims[0] ?? null;
  const promotedLayout = resolvePromotedLiveLayout({
    activeTab,
    hasCheckedCard: Boolean(latestCheckedCard),
    hasPendingClaim: Boolean(latestPendingClaim),
  });
  // FIX: LIVE tab limits to MAX_HISTORY_ROWS, HISTORY tab shows ALL cards.
  // When a pending claim is active, it owns the hero slot and the latest checked
  // card stays below it instead of teleporting upward after resolution.
  const olderCards = activeTab === 'live'
    ? cards.slice(
        promotedLayout.olderCardsStartIndex,
        promotedLayout.olderCardsStartIndex + MAX_HISTORY_ROWS,
      )
    : displayCards;
  const checkingTimestamp = latestPendingClaim?.timestampSeconds ?? lastScannedTimestamp;
  const activePreview = latestPendingClaim?.claimText?.trim() || currentScanPreview?.trim() || '';
  const activeReadingTimestamp = lastScannedTimestamp ?? liveTimestampSeconds;
  const hasScanSignal =
    chunksScanned > 0 ||
    lastScannedTimestamp !== null ||
    Boolean(currentScanPreview);
  const liveStripMode = getLiveStripMode({
    activeTab,
    status,
    hasCheckedCard: Boolean(latestCheckedCard),
    hasPendingClaim: Boolean(latestPendingClaim),
    hasScanSignal,
  });
  const isLiveReading = liveStripMode !== null || status === 'verifying';
  const showTypingCursor = status !== 'idle' && status !== 'error' && status !== 'no-transcript';

  const primaryStripMode =
    !latestCheckedCard && !latestPendingClaim && liveStripMode
      ? liveStripMode
      : null;
  const secondaryStripMode =
    latestCheckedCard && !latestPendingClaim && liveStripMode && liveStripMode !== 'primary'
      ? liveStripMode
      : null;

  const showResumeLive =
    !isPinned &&
    isLiveReading &&
    activeTab === 'live' &&
    (cards.length > 0 || pendingClaims.length > 0 || Boolean(currentScanPreview));
  const promotedHeroKey = promotedLayout.heroMode === 'pending'
    ? latestPendingClaim?.id ?? null
    : promotedLayout.heroMode === 'checked' && latestCheckedCard
      ? buildPromotedClaimKey({
          claimText: latestCheckedCard.claim.claimText,
          timestampSeconds: latestCheckedCard.claim.timestampSeconds,
        })
      : null;

  useEffect(() => {
    if (!expandedClaimId) {
      return;
    }

    if (!olderCards.some((card) => card.id === expandedClaimId)) {
      setExpandedClaimId(null);
    }
  }, [expandedClaimId, olderCards]);

  const modelCssVars = buildModelCssVars(selectedModel);

  return (
    <div className="relative" style={modelCssVars}>
      <div
        className="relative flex flex-col gap-2.5 px-3 pb-3 pt-2"
        style={{ ...FEED_RAIL_LAYOUT, ...modelCssVars } as CSSProperties}
      >
        <div className="signal-rail" />

        {isInitialLoading ? (
          <SkeletonCard />
        ) : (
          <>
            {/* Primary: reading strip when nothing else to show */}
            {activeTab === 'live' && primaryStripMode && (
              <LiveReadingStrip
                timestampSeconds={activeReadingTimestamp}
                previewText={activePreview}
                mode={primaryStripMode}
                showCursor={showTypingCursor}
                extractedEntities={scanEntities}
                actionState={scanActionState}
                reason={scanReason}
                onEntitySelect={onEntitySelect}
              />
            )}

            {/* Hero slot: the currently promoted claim always lives at the top.
                A verifying claim owns this slot first, then resolves in-place
                into the finished card instead of jumping between lanes. */}
            {activeTab === 'live' && (
              <AnimatePresence mode="popLayout">
                {promotedLayout.heroMode !== 'none' && (
                  <motion.div
                    key={promotedHeroKey ?? promotedLayout.heroMode}
                    className="transformer-card"
                    layoutId={promotedHeroKey ? `promoted-claim-${promotedHeroKey}` : undefined}
                    initial={prefersReducedMotion ? false : transformerVariants.initial}
                    animate={transformerVariants.animate}
                    exit={prefersReducedMotion ? undefined : transformerVariants.exit}
                    transition={{
                      ...TRANSFORMER_TRANSITION,
                      duration: promotedLayout.heroMode === 'pending' ? 0.45 : undefined,
                    }}
                  >
                    {promotedLayout.heroMode === 'pending' && latestPendingClaim ? (
                      <LiveCheckingCard
                        timestampSeconds={checkingTimestamp}
                        claimText={latestPendingClaim.claimText || 'Checking that claim…'}
                      />
                    ) : latestCheckedCard ? (
                      <RailEntry
                        timestampSeconds={latestCheckedCard.timestampSeconds}
                        style={VERDICT_META[latestCheckedCard.status].railStyle}
                      >
                        <LiveResultCard {...latestCheckedCard} isLatest />
                      </RailEntry>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            )}

            {/* Continue showing active reading after the first checked card so the feed
                does not appear frozen between verification events. */}
            {secondaryStripMode && (
              <LiveReadingStrip
                timestampSeconds={activeReadingTimestamp}
                previewText={currentScanPreview || activePreview || 'Scanning for claims…'}
                mode={secondaryStripMode}
                showCursor={secondaryStripMode === 'forming' && showTypingCursor}
                extractedEntities={scanEntities}
                actionState={scanActionState}
                reason={scanReason}
                onEntitySelect={onEntitySelect}
              />
            )}

            {/* No-transcript / error / idle states */}
            {activeTab === 'live' && !latestCheckedCard && !latestPendingClaim && !primaryStripMode && (
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
                // FIX: Never show Idle when monitoring/verifying/ready - show scanning state instead
                <LiveReadingStrip
                  timestampSeconds={activeReadingTimestamp}
                  previewText={currentScanPreview || 'Scanning for claims…'}
                  mode="primary"
                  showCursor={true}
                  extractedEntities={scanEntities}
                  actionState={scanActionState}
                  reason={scanReason || 'Listening for checkable claims.'}
                  onEntitySelect={onEntitySelect}
                />
              ) : (
                <StateCard
                  badgeLabel={status === 'loading' ? 'Loading' : 'Idle'}
                  badgeTone={status === 'loading' ? 'text-sc-accent' : 'text-textMuted'}
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
              <div className="flex flex-col">
                <div className={activeTab === 'history' ? 'pl-[24px]' : 'pl-[72px]'}>
                  <div className="ml-1">
                    <p className="feed-section-label">
                      {activeTab === 'history' ? 'All checked claims' : 'Checked so far'}
                    </p>
                  </div>
                </div>
                {olderCards.map((card, index) => (
                  <CheckedClaimRow
                    key={`h-${card.id}`}
                    card={card}
                    isExpanded={expandedClaimId === card.id}
                    onToggle={() => {
                      setExpandedClaimId((current) => (current === card.id ? null : card.id));
                    }}
                    isHistoryMode={activeTab === 'history'}
                    isLast={index === olderCards.length - 1}
                    enableLayoutAnimation={enableListLayoutAnimations}
                  />
                ))}
              </div>
            )}

            {/* Empty history state */}
            {activeTab === 'history' && displayCards.length === 0 && askHistory.length === 0 && (
              <StateCard
                badgeLabel="No results yet"
                badgeTone="text-sc-muted"
                timestampSeconds={null}
                tone="muted"
                headline="Nothing checked yet."
                supportLine="Verified claims will appear here as the video plays. Switch to LIVE to see active scanning."
              />
            )}

            {/* Q&A History (HISTORY tab only) */}
            {activeTab === 'history' && askHistory.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="pl-[72px]">
                  <div className="ml-1">
                    <p className="feed-section-label feed-section-label-qa">Q&A History</p>
                  </div>
                </div>
                {askHistory.map((entry, index) => (
                  <AskResponseCard
                    key={`${entry.query}-${entry.timestampSeconds}-${index}`}
                    query={entry.query}
                    answer={entry.answer}
                    timestampSeconds={entry.timestampSeconds}
                    sources={entry.sources}
                  />
                ))}
              </div>
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
            <span
              className="block h-[7px] w-[7px] rotate-45"
              style={{ backgroundColor: 'var(--model-accent-solid)' }}
            />
            <span>Resume Live</span>
          </button>
        </div>
      )}
    </div>
  );
};
