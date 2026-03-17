// ============================================
// TEST SCRIPT — test the grounded Gemini pipeline
// ============================================
// Run: npx tsx scripts/test-pipeline.ts
//
// Tests the full flow:
//   transcript chunk → claim extraction (Gemini)
//   → claim verification (Gemini + Google Search grounding)
//   → source card

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const EXTENSION_ID = process.env.EXTENSION_ID || 'local-dev-extension';

const isLocalApiHost = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  } catch {
    return false;
  }
};

const getSessionToken = async () => {
  const res = await fetch(`${API_BASE}/api/session/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Extension-Id': EXTENSION_ID,
    },
    body: JSON.stringify({ extensionId: EXTENSION_ID }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(
      `Session init failed (${res.status}). ` +
        'Check ALLOWED_EXTENSION_IDS and EXTENSION_ID. ' +
        (errorText ? `Body: ${errorText.slice(0, 200)}` : '')
    );
  }

  const data = await res.json().catch(() => ({}));
  const token = typeof (data as { token?: unknown }).token === 'string' ? (data as { token: string }).token : '';
  if (!token && !isLocalApiHost(API_BASE)) {
    throw new Error(
      'Session init returned an empty token on a non-local API_BASE. ' +
        'Set SESSION_SECRET on the deployed backend.'
    );
  }

  return token;
};

const buildHeaders = (token: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Extension-Id': EXTENSION_ID,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

const TEST_CHUNKS = [
  {
    text: "so there's a really interesting study out of Scandinavia where they had subjects immerse themselves in cold water at about fourteen degrees Celsius for one hour and they measured a two hundred and fifty percent increase in dopamine that lasted for several hours after the exposure which is remarkable because that's on par with what you see with certain pharmacological interventions",
    startTime: 743,
    duration: 28,
    index: 24,
  },
  {
    text: "and the lead author on that was Šrámek and colleagues published in the European Journal of Applied Physiology back in two thousand and they also noted increases in norepinephrine by about five hundred and thirty percent which is even more dramatic and I think this is why people report feeling so alert after cold exposure",
    startTime: 771,
    duration: 25,
    index: 25,
  },
];

async function testAnalyzeChunk() {
  console.log('\n=== STEP 1: Claim Extraction (Gemini, no search) ===\n');
  const token = await getSessionToken();

  const response = await fetch(`${API_BASE}/api/analyze-chunk`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({
      videoId: 'test_video_123',
      videoTitle: 'The Science of Cold Exposure',
      channelName: 'Andrew Huberman',
      chunks: TEST_CHUNKS,
      currentTimestamp: 743,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('FAILED:', response.status, error);
    process.exit(1);
  }

  const data = await response.json();
  console.log(`Found ${data.claims.length} claims:\n`);

  for (const claim of data.claims) {
    console.log(`  [${claim.claimType.toUpperCase()}] ${claim.claimText}`);
    console.log(`  Confidence: ${claim.confidence}`);
    console.log(`  Quote: "${claim.exactQuote.substring(0, 80)}..."`);
    console.log();
  }

  return data.claims;
}

async function testVerifyClaim(claim: any) {
  console.log(`\n=== STEP 2: Verification (Gemini + Google Search) ===`);
  console.log(`Verifying: "${claim.claimText}"\n`);
  const token = await getSessionToken();

  const response = await fetch(`${API_BASE}/api/verify-claim`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({
      claim,
      videoTitle: 'The Science of Cold Exposure',
      channelName: 'Andrew Huberman',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('FAILED:', response.status, error);
    return;
  }

  const data = await response.json();
  const card = data.sourceCard;

  console.log('  ┌──────────────────────────────────────────────┐');
  console.log(`  │ STATUS: ${card.status.toUpperCase().padEnd(37)}│`);
  console.log(`  │ Source: ${card.sourceTitle.substring(0, 37).padEnd(37)}│`);
  console.log(`  │ Type:   ${card.sourceType.padEnd(37)}│`);
  console.log('  ├──────────────────────────────────────────────┤');
  
  // Word-wrap the nuance line
  const nuance = card.nuance || '';
  const lineLen = 44;
  for (let i = 0; i < nuance.length; i += lineLen) {
    console.log(`  │ ${nuance.substring(i, i + lineLen).padEnd(lineLen)} │`);
  }
  
  console.log('  ├──────────────────────────────────────────────┤');
  const url = card.sourceUrl || '(no URL from grounding)';
  console.log(`  │ ${url.substring(0, 44).padEnd(44)} │`);
  console.log('  └──────────────────────────────────────────────┘');
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║ SOURCECHECK — GROUNDED GEMINI PIPELINE TEST ║');
  console.log('║ Using: Gemini + Google Search Grounding     ║');
  console.log('║ APIs needed: 1 (just GEMINI_API_KEY)        ║');
  console.log('╚══════════════════════════════════════════════╝');

  const claims = await testAnalyzeChunk();

  if (claims.length === 0) {
    console.log('\nNo claims found. Check prompts or API key.');
    process.exit(1);
  }

  await testVerifyClaim(claims[0]);

  if (claims.length > 1) {
    await testVerifyClaim(claims[1]);
  }

  console.log('\n✅ Pipeline test complete!');
  console.log('   One API key. Grounded verification through Gemini.\n');
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
