import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSONWithSearch, isGeminiError } from '@/lib/gemini';
import { buildGroundedVerificationPrompt } from '@/lib/prompts';
import type {
  VerifyClaimRequest,
  VerifyClaimResponse,
  SourceCard,
  VerificationStatus,
} from '@/types/shared';

interface RawVerification {
  status: string;
  sourceTitle: string;
  sourceType: string;
  nuance: string;
}

const MAX_CLAIM_TEXT_LENGTH = 700;
const MAX_METADATA_FIELD_LENGTH = 300;
const MAX_NUANCE_LENGTH = 600;

// Phrases that assert definite verdicts — inappropriate when no grounded
// sources exist to back them up. Covers both negative AND positive certainty.
const NEGATIVE_CERTAINTY_RE =
  /\b(this is false|fabricat(ed|ion)|no credible record|clearly false|proven false|definitively (false|wrong|incorrect)|debunked|never happened|completely false|entirely false)\b/i;
const POSITIVE_CERTAINTY_RE =
  /\b(confirmed|verified|well.documented|widely reported|established fact|proven true|definitively (true|correct|accurate)|backed by|supported by)\b/i;

// When the card ends up unverifiable with no grounding, scrub any training-data
// nuance that sounds stronger than the evidence warrants — whether positive or negative.
const guardUnverifiableNuance = (nuance: string, hasGrounding: boolean): string => {
  if (!hasGrounding && (NEGATIVE_CERTAINTY_RE.test(nuance) || POSITIVE_CERTAINTY_RE.test(nuance))) {
    return 'Could not find web sources to check this claim.';
  }
  return nuance;
};

const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['supported', 'partial', 'disputed', 'unverifiable'] },
    sourceTitle: { type: 'string' },
    sourceType: { type: 'string', enum: ['academic_paper', 'news_article', 'official_source', 'wikipedia', 'other'] },
    nuance: { type: 'string' },
  },
  required: ['status', 'sourceTitle', 'sourceType', 'nuance'],
  additionalProperties: false,
};

const normalizeValue = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const sanitizeHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
};

const validateVerifyClaimRequest = (body: VerifyClaimRequest) => {
  if (!body.claim || typeof body.claim.claimText !== 'string' || !body.claim.claimText.trim()) {
    return 'claim with claimText is required.';
  }

  if (body.claim.claimText.length > MAX_CLAIM_TEXT_LENGTH) {
    return `claimText exceeds ${MAX_CLAIM_TEXT_LENGTH} characters.`;
  }

  if ((body.videoTitle || '').length > MAX_METADATA_FIELD_LENGTH) {
    return 'videoTitle is too long.';
  }

  if ((body.channelName || '').length > MAX_METADATA_FIELD_LENGTH) {
    return 'channelName is too long.';
  }

  if (!Number.isFinite(body.claim.timestampSeconds) || body.claim.timestampSeconds < 0) {
    return 'claim.timestampSeconds must be a non-negative number.';
  }

  return null;
};

const scoreGroundingSource = (
  source: { title: string; url: string },
  desiredTitle: string
) => {
  const normalizedDesired = normalizeValue(desiredTitle);
  if (!normalizedDesired) {
    return 0;
  }

  const normalizedSourceTitle = normalizeValue(source.title);
  let score = 0;

  if (normalizedSourceTitle === normalizedDesired) {
    score += 100;
  }

  if (normalizedSourceTitle.includes(normalizedDesired) || normalizedDesired.includes(normalizedSourceTitle)) {
    score += 40;
  }

  normalizedDesired.split(' ').forEach((token) => {
    if (token.length >= 4 && normalizedSourceTitle.includes(token)) {
      score += 5;
    }
  });

  return score;
};

const selectBestSourceUrl = (
  desiredTitle: string,
  sources: Array<{ title: string; url: string }>
) => {
  const sanitizedSources = sources
    .map((source) => ({
      title: source.title,
      url: sanitizeHttpUrl(source.url || ''),
    }))
    .filter((source) => source.url);

  if (!sanitizedSources.length) {
    return '';
  }

  if (!desiredTitle.trim()) {
    return sanitizedSources[0].url;
  }

  let bestSource = sanitizedSources[0];
  let bestScore = scoreGroundingSource(bestSource, desiredTitle);

  for (const source of sanitizedSources.slice(1)) {
    const score = scoreGroundingSource(source, desiredTitle);
    if (score > bestScore) {
      bestSource = source;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestSource.url : '';
};

export async function POST(request: NextRequest) {
  try {
    const body: VerifyClaimRequest = await request.json();

    const validationError = validateVerifyClaimRequest(body);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    const { claim } = body;

    // ---- Single Gemini call with Google Search grounding ----
    // Gemini searches the web automatically and returns both
    // the verification JSON and the grounding source URLs.
    const prompt = buildGroundedVerificationPrompt(claim.claimText, claim.claimType);

    const { data: rawVerification, inputTokens, outputTokens, sources } =
      await askGeminiJSONWithSearch<RawVerification>(prompt, 500, VERIFICATION_SCHEMA);

    // ---- Validate status ----
    const validStatuses: VerificationStatus[] = ['supported', 'partial', 'disputed', 'unverifiable'];
    const parsedStatus: VerificationStatus = validStatuses.includes(rawVerification.status as VerificationStatus)
      ? (rawVerification.status as VerificationStatus)
      : 'unverifiable';

    // ---- Trust guard: no grounding sources = no evidence-backed verdict ----
    // If Gemini returned no grounding chunks the model answered from training data
    // alone. Downgrade any positive/negative verdict to unverifiable so cards never
    // show supported/partial/disputed without real web evidence behind them.
    const hasGrounding = sources.length > 0;
    const status: VerificationStatus = hasGrounding ? parsedStatus : 'unverifiable';

    // ---- Validate source type ----
    const validSourceTypes = ['academic_paper', 'news_article', 'official_source', 'wikipedia', 'other'] as const;
    const sourceType = (validSourceTypes as readonly string[]).includes(rawVerification.sourceType)
      ? (rawVerification.sourceType as typeof validSourceTypes[number])
      : 'other';

    // ---- Get source URL from grounding metadata ----
    // Gemini returns the actual URLs it used in groundingChunks.
    // Fall back to empty string if none available.
    const bestSourceUrl = hasGrounding
      ? selectBestSourceUrl(rawVerification.sourceTitle || '', sources)
      : '';

    // ---- Resolve source title ----
    // When ungrounded, always replace the model's source title — it may cite
    // specific papers/outlets from training data that we cannot link to.
    const rawSourceTitle = typeof rawVerification.sourceTitle === 'string'
      ? rawVerification.sourceTitle.trim()
      : '';
    const sourceTitle = hasGrounding
      ? (rawSourceTitle || 'Unknown source')
      : 'No web source found';
    const resolvedSourceType = hasGrounding ? sourceType : 'other';

    const sourceCard: SourceCard = {
      id: crypto.randomUUID(),
      claim,
      status,
      sourceTitle: sourceTitle.slice(0, MAX_METADATA_FIELD_LENGTH),
      sourceUrl: bestSourceUrl,
      sourceType: resolvedSourceType,
      nuance: guardUnverifiableNuance(
        String(typeof rawVerification.nuance === 'string' ? rawVerification.nuance : 'No additional context available.').slice(0, MAX_NUANCE_LENGTH),
        hasGrounding,
      ),
      timestampSeconds: claim.timestampSeconds,
      verifiedAt: new Date().toISOString(),
    };

    console.info('[verify-claim]', {
      parsedStatus,
      status: sourceCard.status,
      hasGrounding,
      sourceCount: sources.length,
      inputTokens,
      outputTokens,
    });

    return NextResponse.json<VerifyClaimResponse>({ sourceCard });

  } catch (error: unknown) {
    console.error('[verify-claim] Error:', {
      name: error instanceof Error ? error.name : typeof error,
      code: isGeminiError(error) ? error.code : undefined,
      status: isGeminiError(error) ? error.status : undefined,
    });

    if (isGeminiError(error) && error.code === 'RATE_LIMITED') {
      return NextResponse.json(
        { error: 'Rate limited. Please wait a moment.' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to verify claim.' },
      { status: 500 }
    );
  }
}
