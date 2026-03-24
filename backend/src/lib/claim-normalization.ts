import { computeCheckworthiness } from './checkworthiness';
import type {
  ClaimAttributionType,
  ClaimComparisonOperator,
  ClaimFeatureVector,
  ClaimTimeSensitivity,
  ClaimType,
  ExtractedClaim,
} from '@/types/shared';

export const CLAIM_NORMALIZATION_VERSION = 1;

const MONTH_PATTERN =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const YEAR_PATTERN = /\b(19|20)\d{2}\b/;
const RELATIVE_TIME_PATTERN =
  /\b(today|yesterday|tomorrow|tonight|currently|now|this week|this month|this year|this quarter|last week|last month|last year|last quarter|next quarter|recently)\b/i;
const BREAKING_TIME_PATTERN =
  /\b(today|yesterday|tomorrow|tonight|currently|now|this week|this month|recently|latest|just|breaking)\b/i;
const PRESIDENCY_PATTERN = /\bduring (his|her|their|the) presidency\b/i;
const QUARTER_PATTERN =
  /\b(?:q([1-4])|([1-4])(st|nd|rd|th)\s+quarter|first quarter|second quarter|third quarter|fourth quarter)(?:\s+of)?\s+((?:19|20)\d{2})\b/i;
const NEGATION_PATTERN =
  /\b(not|no|never|none|neither|n't|cannot|can't|won't|didn't|doesn't|isn't|aren't|wasn't|weren't|without)\b/i;
const REPORTED_CLAIM_PATTERN =
  /\b(according to|reportedly|analysts say|officials say|reports say|critics say|supporters say)\b/i;
const QUOTED_CLAIM_PATTERN = /["“”']|(?:\bsaid\b|\bsays\b|\bclaimed\b|\bposted\b)/i;
const LEADING_FILLER_PATTERN = /^(?:[-–—:;,.]\s*|and\s+|but\s+|so\s+|well\s+|look\s+|listen\s+)+/i;
const LOCATION_PATTERN =
  /\b(?:in|at|across|throughout|inside)\s+([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,3}|the\s+[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,3})\b/;
const ATTRIBUTED_ENTITY_PATTERN =
  /\b(?:according to|analysts say|officials say|reports say|critics say|supporters say)\s+([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,3})/i;
const SUBJECT_VERB_PATTERN =
  /\b(has been|have been|had been|did not|does not|do not|is not|are not|was not|were not|will not|has|have|had|is|are|was|were|raised|rejected|reported|posted|said|says|confirmed|opposes|oppose|cut|cuts|increased|increase|decreased|decrease|rose|rise|fell|fall|won|lost|built|created|launched|developed|approved|blocked|funded|closed|shut down)\b/i;

const TOPIC_TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'economy', pattern: /\b(inflation|economy|gdp|market|stocks|jobs|unemployment|recession)\b/i },
  { tag: 'taxes', pattern: /\b(tax|taxes|tariff|tariffs|revenue)\b/i },
  { tag: 'immigration', pattern: /\b(immigration|border|migrant|migrants|asylum|deport)\b/i },
  { tag: 'healthcare', pattern: /\b(health|healthcare|hospital|medicare|medicaid|insurance|vaccine)\b/i },
  { tag: 'elections', pattern: /\b(election|vote|voter|ballot|poll|campaign)\b/i },
  { tag: 'crime', pattern: /\b(crime|murder|violent crime|homicide|arrest)\b/i },
  { tag: 'education', pattern: /\b(school|education|student|teacher|college|university)\b/i },
  { tag: 'energy', pattern: /\b(oil|gas|energy|electricity|power|solar|wind)\b/i },
  { tag: 'foreign_policy', pattern: /\b(iran|china|russia|ukraine|nato|foreign policy|diplomacy|war)\b/i },
  { tag: 'defense', pattern: /\b(defense|military|troops|strike|missile|airstrike)\b/i },
  { tag: 'science', pattern: /\b(study|research|scientist|experiment|physics|climate)\b/i },
  { tag: 'technology', pattern: /\b(ai|artificial intelligence|technology|chip|chips|nvidia|software)\b/i },
];

const DEFAULT_FEATURES = (): ClaimFeatureVector => ({
  speaker: null,
  attributedEntity: null,
  subject: null,
  predicate: null,
  object: null,
  polarity: 'uncertain',
  quantityRaw: null,
  quantityValue: null,
  quantityUnit: null,
  comparisonOperator: null,
  dateOrPeriodRaw: null,
  dateOrPeriodNormalized: null,
  timeSensitivity: 'evergreen',
  location: null,
  topicTags: [],
  attributionType: 'speaker_assertion',
});

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const cleanClaimText = (value: string) =>
  normalizeWhitespace(value.replace(LEADING_FILLER_PATTERN, '').replace(/[“”]/g, '"'));

const detectAttributionType = (claimText: string): ClaimAttributionType => {
  if (REPORTED_CLAIM_PATTERN.test(claimText)) {
    return 'reported_claim';
  }
  if (QUOTED_CLAIM_PATTERN.test(claimText)) {
    return 'quoted_claim';
  }
  return 'speaker_assertion';
};

const detectPolarity = (claimText: string) =>
  NEGATION_PATTERN.test(claimText) ? 'negated' : 'affirmed';

const detectComparisonOperator = (claimText: string): ClaimComparisonOperator => {
  if (/\b(nearly|about|around|roughly|approximately|almost|up to)\b/i.test(claimText)) {
    return 'approx';
  }
  if (/\b(at least|no less than)\b/i.test(claimText)) {
    return 'gte';
  }
  if (/\b(more than|over|greater than|exceeds)\b/i.test(claimText)) {
    return 'gt';
  }
  if (/\b(at most|no more than)\b/i.test(claimText)) {
    return 'lte';
  }
  if (/\b(less than|fewer than|under|below)\b/i.test(claimText)) {
    return 'lt';
  }
  return /\d/.test(claimText) ? 'eq' : null;
};

const parseNumericValue = (rawNumber: string, scaleToken?: string): number | null => {
  const normalized = rawNumber.replace(/[$,]/g, '');
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;

  const scale = scaleToken?.toLowerCase();
  if (scale === 'billion') return value * 1_000_000_000;
  if (scale === 'million') return value * 1_000_000;
  if (scale === 'thousand') return value * 1_000;
  return value;
};

const extractQuantity = (claimText: string) => {
  const quantityMatch = claimText.match(
    /\b(\$?\d[\d,]*(?:\.\d+)?)(?:\s*(billion|million|thousand))?(?:\s*(percentage points|%|percent|days?|people|votes?|dollars?|years?))?/i,
  );
  if (!quantityMatch) {
    return {
      quantityRaw: null,
      quantityValue: null,
      quantityUnit: null,
    };
  }

  const [, rawNumber, scaleToken, unitToken] = quantityMatch;
  const quantityRaw = quantityMatch[0]?.trim() || null;
  const quantityUnit = unitToken
    ? unitToken.toLowerCase()
    : rawNumber.startsWith('$')
      ? 'dollars'
      : scaleToken
        ? scaleToken.toLowerCase()
        : null;

  return {
    quantityRaw,
    quantityValue: parseNumericValue(rawNumber, scaleToken),
    quantityUnit,
  };
};

const extractDateOrPeriod = (claimText: string) => {
  const relative = claimText.match(RELATIVE_TIME_PATTERN);
  if (relative) {
    const raw = relative[0];
    return {
      dateOrPeriodRaw: raw,
      dateOrPeriodNormalized: raw.toLowerCase(),
    };
  }

  const quarter = claimText.match(QUARTER_PATTERN);
  if (quarter) {
    const raw = quarter[0];
    const year = quarter[4];
    const normalizedRaw = raw.toLowerCase();
    const quarterNumber = quarter[1]
      ? Number.parseInt(quarter[1], 10)
      : quarter[2]
        ? Number.parseInt(quarter[2], 10)
        : normalizedRaw.includes('first quarter')
          ? 1
          : normalizedRaw.includes('second quarter')
            ? 2
            : normalizedRaw.includes('third quarter')
              ? 3
              : 4;
    return {
      dateOrPeriodRaw: raw,
      dateOrPeriodNormalized: `${year}-q${quarterNumber}`,
    };
  }

  const monthYear = claimText.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+((?:19|20)\d{2})\b/i,
  );
  if (monthYear) {
    const month = monthYear[1];
    const year = monthYear[2];
    return {
      dateOrPeriodRaw: monthYear[0],
      dateOrPeriodNormalized: `${year}-${month.toLowerCase()}`,
    };
  }

  const year = claimText.match(YEAR_PATTERN);
  if (year) {
    return {
      dateOrPeriodRaw: year[0],
      dateOrPeriodNormalized: year[0],
    };
  }

  const presidency = claimText.match(PRESIDENCY_PATTERN);
  if (presidency) {
    return {
      dateOrPeriodRaw: presidency[0],
      dateOrPeriodNormalized: presidency[0].toLowerCase(),
    };
  }

  return {
    dateOrPeriodRaw: null,
    dateOrPeriodNormalized: null,
  };
};

const classifyTimeSensitivity = (claimText: string, claimType: ClaimType): ClaimTimeSensitivity => {
  if (BREAKING_TIME_PATTERN.test(claimText)) {
    return 'breaking';
  }
  if (
    RELATIVE_TIME_PATTERN.test(claimText) ||
    QUARTER_PATTERN.test(claimText) ||
    MONTH_PATTERN.test(claimText) ||
    YEAR_PATTERN.test(claimText) ||
    PRESIDENCY_PATTERN.test(claimText)
  ) {
    return 'time_bound';
  }
  if (claimType === 'historical' || claimType === 'canonical') {
    return 'evergreen';
  }
  return 'evergreen';
};

const extractLocation = (claimText: string) => {
  const match = claimText.match(LOCATION_PATTERN);
  if (!match) return null;
  const candidate = normalizeWhitespace(match[1].replace(/^the\s+/i, 'the '));
  if (!candidate || /^(unknown|n\/a)$/i.test(candidate)) return null;
  return candidate;
};

const extractAttributedEntity = (claimText: string) => {
  const match = claimText.match(ATTRIBUTED_ENTITY_PATTERN);
  return match ? normalizeWhitespace(match[1]) : null;
};

const extractSubjectPredicateObject = (claimText: string) => {
  const normalized = cleanClaimText(claimText);
  const verbMatch = normalized.match(SUBJECT_VERB_PATTERN);
  if (!verbMatch || verbMatch.index === undefined) {
    return {
      subject: null,
      predicate: null,
      object: null,
    };
  }

  const subject = normalizeWhitespace(normalized.slice(0, verbMatch.index));
  const predicate = normalizeWhitespace(verbMatch[0]);
  const object = normalizeWhitespace(normalized.slice(verbMatch.index + verbMatch[0].length));

  return {
    subject: subject || null,
    predicate: predicate || null,
    object: object || null,
  };
};

const deriveTopicTags = (claimText: string) => {
  const tags: string[] = [];
  for (const rule of TOPIC_TAG_RULES) {
    if (rule.pattern.test(claimText)) {
      tags.push(rule.tag);
    }
    if (tags.length === 3) break;
  }
  return tags;
};

export function normalizeExtractedClaim(
  claim: Pick<ExtractedClaim, 'claimText' | 'claimType'>,
): Pick<ExtractedClaim, 'normalizedClaimText' | 'checkworthiness' | 'normalizationVersion' | 'claimFeatures'> {
  const normalizedClaimText = cleanClaimText(claim.claimText);
  const claimFeatures = DEFAULT_FEATURES();

  claimFeatures.attributionType = detectAttributionType(normalizedClaimText);
  claimFeatures.polarity = detectPolarity(normalizedClaimText);
  claimFeatures.comparisonOperator = detectComparisonOperator(normalizedClaimText);

  const subjectParts = extractSubjectPredicateObject(normalizedClaimText);
  claimFeatures.subject = subjectParts.subject;
  claimFeatures.predicate = subjectParts.predicate;
  claimFeatures.object = subjectParts.object;

  const quantity = extractQuantity(normalizedClaimText);
  claimFeatures.quantityRaw = quantity.quantityRaw;
  claimFeatures.quantityValue = quantity.quantityValue;
  claimFeatures.quantityUnit = quantity.quantityUnit;

  const time = extractDateOrPeriod(normalizedClaimText);
  claimFeatures.dateOrPeriodRaw = time.dateOrPeriodRaw;
  claimFeatures.dateOrPeriodNormalized = time.dateOrPeriodNormalized;
  claimFeatures.timeSensitivity = classifyTimeSensitivity(normalizedClaimText, claim.claimType);

  claimFeatures.location = extractLocation(normalizedClaimText);
  claimFeatures.attributedEntity = extractAttributedEntity(normalizedClaimText);
  claimFeatures.topicTags = deriveTopicTags(normalizedClaimText);

  const checkworthiness = computeCheckworthiness({
    claimText: normalizedClaimText,
    claimType: claim.claimType,
    claimFeatures,
  });

  return {
    normalizedClaimText,
    checkworthiness,
    normalizationVersion: CLAIM_NORMALIZATION_VERSION,
    claimFeatures,
  };
}
