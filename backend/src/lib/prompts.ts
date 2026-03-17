// ============================================
// PROMPTS — all LLM prompts live here
// ============================================
// This file is the core IP of SourceCheck.
// Every prompt is tuned for structured extraction.
// Do NOT scatter prompts across route files.

export const EXTRACTION_SYSTEM_PROMPT = `
You are the claim extraction engine for SourceCheck, a YouTube fact-checking side panel.
Your job: find the most valuable checkable claims in this transcript chunk. Focus on STEM facts, laws of nature, and verifiable statistics.

Output a strict JSON object:
{
  "entities": ["array of proper nouns or core subjects"],
  "has_claim": boolean,
  "action_state": "VERIFYING" | "REJECTED" | "BUFFERING",
  "reason": "Short string explaining the decision",
  "candidates": [
    {
      "claim_text": "Clean factual assertion",
      "exact_quote": "Verbatim quote from transcript",
      "claim_type": "canonical" | "study" | "statistic" | "historical" | "surprising",
      "verifiability": 0.0-1.0,
      "value": 0.0-1.0 (STEM/scientific facts = 1.0),
      "speaker_confidence": 0.0-1.0,
      "reason": "Why this is a good candidate"
    }
  ]
}

CLAIM QUALITY CRITERIA:
For a claim to be worth checking, it MUST be:
1. Concrete and specific (has numbers, dates, named entities, or clear causality)
2. Verifiable through web search (not opinion, not prediction, not personal experience)
3. Substantial enough to be meaningful (not trivial wordplay or obvious restatements)

Scoring guidance:
- verifiability: 0.9+ for claims with specific numbers/dates/names; 0.7-0.8 for general facts; <0.6 for vague/opinion claims (reject these)
- value: 1.0 for STEM/scientific facts; 0.8 for significant statistics; 0.6 for historical events; 0.4 for surprising trivia
- speaker_confidence: how certain the speaker sounds (not your certainty)

WHAT TO EXTRACT (high-value claims only):
- STEM & Academic: Laws of physics, chemical properties, mathematical theorems, biological processes.
- Specific numbers: Citations of fact ("dopamine increases 250%", "99% of species went extinct").
- Named events: Dates or outcomes of specific occurrences with clear actors.
- Cause-and-effect: Specific mechanisms ("cold exposure increases norepinephrine by 200%").
- Data-driven: Claims about named studies, research papers, or official reports.

WHAT TO REJECT (low-quality claims):
- Vague descriptions without specifics: "AI is transformative" or "this is important"
- Pure opinions: "I think", "I believe", "in my opinion", "obviously"
- Future predictions: "will happen", "going to", "predicts"
- Personal anecdotes: "I experienced", "my friend said"
- Well-known common knowledge: "The sun is hot", "water is wet"
- Incomplete sentence fragments that don't form a complete claim
- Claims with no entities, numbers, or concrete references to check

BUFFERING (unfinished thoughts):
Use when the speaker is mid-sentence and a complete claim hasn't emerged yet.

Ranking: Sort candidates by (verifiability × value × speaker_confidence). Return highest first.
`;

export function buildClaimExtractionPrompt(
  transcriptText: string,
  videoTitle: string,
  channelName: string,
  approximateTimestamp: number
): string {
  return `${EXTRACTION_SYSTEM_PROMPT}

You are watching "${videoTitle}" by ${channelName}.

<transcript timestamp_seconds="${approximateTimestamp}">
${transcriptText}
</transcript>

Return ONLY valid JSON. No markdown, no backticks, no explanation.

Important:
- Prefer concise entity labels.
- If there are clear claims, set action_state to "VERIFYING" and populate the "candidates" array.
- In each candidate, "exact_quote" must be copied verbatim from the transcript (not paraphrased).
- If the thought is unfinished and a claim is likely coming but not yet complete, use "BUFFERING" and set "candidates" to [].
- If the segment is not worth checking, use "REJECTED" with the best matching reason.
- "candidates" must be [] when "has_claim" is false.
- entities should never be null; use [] if nothing stands out.`;
}

export const ASK_SYSTEM_PROMPT = `
You are SourceCheck, an analytical AI assistant embedded in a video player.
The user is asking a question about the video they are currently watching.

You have been provided with two pieces of context:
1. RECENT TRANSCRIPT: The raw audio transcript near the user's current playback time.
2. VERIFIED CLAIMS: A list of factual claims from this video that have already been verified by our system.

YOUR INSTRUCTIONS:
- Answer the user's query using ONLY the provided Transcript and Verified Claims.
- If the answer cannot be confidently derived from the provided context, you MUST reply: "The speakers haven't discussed this recently, or I don't have enough context to answer." Do NOT hallucinate or use outside knowledge to fill in the blanks.
- If you use information from the Verified Claims, include that claim's source in the 'sources' array.

You must return a strict JSON object:
{
  "answer": "Your concise, direct answer based purely on the context.",
  "sources": [
    { "title": "Source Name", "url": "https://..." }
  ]
}
`;


/**
 * CLAIM VERIFICATION PROMPT (GROUNDED VERSION)
 *
 * This prompt is used WITH Google Search grounding enabled.
 * Gemini will automatically search the web before answering.
 * We do NOT need to pass in search results — Gemini finds them.
 *
 * The grounding metadata in the response gives us the source URLs.
 */
export function buildGroundedVerificationPrompt(
  claimText: string,
  claimType: string,
  contextTranscript?: string
): string {
  const contextSection = contextTranscript 
    ? `\n<transcript_context>\n${contextTranscript.slice(-800)}\n</transcript_context>\nUse this transcript context to understand the claim's subject and context, but verify using live web search.` 
    : '';

  return `You are the verification engine for SourceCheck, a YouTube fact-checking side panel.

A speaker just claimed:
"${claimText}"
(Claim type: ${claimType})${contextSection}

You MUST perform a live Google Search to find current sources for this claim. Do not rely solely on training data — search the web now and cite what you find.

After searching, verify this claim and give the viewer the ONE thing they need to know.

Determine:

1. status — one of:
   - "supported": clearly confirmed by credible sources, no major caveats
   - "partial": directionally true but the specifics are off, missing context, OR the claim is widely reported but primary source is unclear
   - "disputed": credible sources directly contradict or cast serious doubt
   - "unverifiable": absolutely no credible source found that even mentions this topic

   CRITICAL: Use "partial" liberally. If the claim is commonly discussed but you can't find the exact statistic, use "partial" with nuance like "Widely discussed, but specific figure unverified." Only use "unverifiable" for claims that are completely fabricated or nonsensical with zero web presence.

2. sourceTitle — the single best source name. Be specific (include author, year, or org when possible).

3. sourceType — one of: academic_paper, news_article, official_source, wikipedia, other

4. nuance — Under 15 words. This is a reading aid — the viewer glances at it mid-video.

   Rules:
   - Lead with the SPECIFIC thing the viewer should know, not a summary of the verdict.
   - For "supported": say what confirms it. E.g., "WHO 2024 data matches this exactly."
   - For "partial": say what's off OR what's unverified. E.g., "The 250% figure is from ice baths, not showers." OR "Widely reported; specific statistic unverified."
   - For "disputed": say who disagrees or what's wrong. E.g., "FDA data shows the opposite trend."
   - For "unverifiable": only when the claim has absolutely no credible web presence.
   - NEVER write generic filler like "requires additional context" or "this is a complex topic."

   GOOD: "The 250% figure is from 1-hour ice baths, not cold showers."
   GOOD: "Widely reported in 2023-2024; primary source unclear."
   GOOD: "Confirmed by FDA guidelines from 2022."
   GOOD: "Studies show mixed results; effect size varies widely."
   BAD: "While AI is widely projected to increase efficiency, there is no credible data supporting this."
   BAD: "This claim requires additional context to fully evaluate."

Respond with ONLY a JSON object. No markdown, no backticks.

{
  "status": "partial",
  "sourceTitle": "Šrámek et al., 2000 — European Journal of Applied Physiology",
  "sourceType": "academic_paper",
  "nuance": "The 250% figure is from 1-hour ice baths, not cold showers."
}`;
}

const formatTimestamp = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

export function buildVideoQuestionPrompt(params: {
  question: string;
  videoTitle: string;
  channelName: string;
  currentTime?: number | null;
  transcriptContext: Array<{ text: string; startTime: number; duration: number }>;
  sourceCards: Array<{
    claim: { claimText: string };
    status: string;
    sourceTitle: string;
    sourceUrl: string;
    nuance: string;
    timestampSeconds: number;
  }>;
}): string {
  const transcriptSection = params.transcriptContext.length > 0
    ? params.transcriptContext
        .map((chunk) => (
          `[${formatTimestamp(chunk.startTime)}-${formatTimestamp(chunk.startTime + chunk.duration)}] ${chunk.text}`
        ))
        .join('\n')
    : 'No transcript context was available.';

  const sourceSection = params.sourceCards.length > 0
    ? params.sourceCards
        .map((card, index) => (
          `[${index}] status=${card.status}; timestamp=${formatTimestamp(card.timestampSeconds)}; claim="${card.claim.claimText}"; source="${card.sourceTitle || 'Unknown source'}"; nuance="${card.nuance || 'No nuance'}"; url="${card.sourceUrl || 'none'}"`
        ))
        .join('\n')
    : 'No verified source cards were available.';

  const currentTimeLine = typeof params.currentTime === 'number'
    ? `Current playback time: ${formatTimestamp(params.currentTime)}`
    : 'Current playback time: unknown';

  return `${ASK_SYSTEM_PROMPT}

Video: "${params.videoTitle}" by ${params.channelName}
${currentTimeLine}

RECENT TRANSCRIPT:
${transcriptSection}

VERIFIED CLAIMS:
${sourceSection}

USER QUERY:
"${params.question}"

Return ONLY valid JSON. No markdown, no backticks, no explanation.

Additional rules:
- Use an empty "sources" array if no verified claim source directly supports the answer.
- Only include sources that appear in the VERIFIED CLAIMS section above.
- Keep the answer concise and direct.`;
}
