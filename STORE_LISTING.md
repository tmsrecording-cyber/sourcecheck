# SourceCheck — Chrome Web Store Listing

## Extension Name
SourceCheck

## Short Description (132 char max — currently 118)
Live AI fact-checking as you watch YouTube. Spots claims, finds sources, and shows what's verified — in real time.

## Category
Productivity

## Language
English (United States)

---

## Full Description (16,000 char max)

**SourceCheck watches YouTube with you and fact-checks claims as they happen.**

Most misinformation spreads before anyone thinks to verify it. SourceCheck closes that gap — it listens to the video you're watching, detects factual claims in real time, and quietly checks them against the web while you keep watching. No copy-pasting. No tab-switching. No waiting until after the video ends.

---

### How it works

1. **Open a YouTube video** and click the SourceCheck icon to open the side panel.
2. **Watch normally.** SourceCheck reads the live captions and scans for checkable claims.
3. **See results as they happen.** When a claim is verified, a card appears in the panel showing the verdict (Supported / Mixed / Unsupported), the evidence, and the source.
4. **Tap any card** to expand the full reasoning and source link.

---

### What it checks

SourceCheck focuses on hard factual claims: statistics, historical facts, causal claims, quotes, and scientific assertions. It ignores opinions and subjective statements — only things that can actually be verified with evidence.

---

### Privacy-first by design

- **No account required.** Start checking immediately.
- **No data collected.** Transcript text is processed through your own API key and never stored on our servers.
- **Session-only by default.** Your API key is cleared when you close the browser unless you choose to save it.
- **No tracking, no analytics, no selling your data.** Ever.

---

### Bring Your Own Key (BYOK)

SourceCheck uses Google's Gemini AI for verification. You can use our managed quota (free, limited) or connect your own Google AI Studio key for full speed and model selection. Your key stays on your device.

Get a free key at: aistudio.google.com/app/apikey

---

### What you'll see

**Live Check panel** — shows the current scanning state, active verification, and the most recent result.

**Recent Checks** — a running list of every claim checked in the current video, color-coded by verdict. Tap to expand full evidence and source.

**History tab** — all verified claims from your session, searchable by video.

---

### Verdict labels

- **Supported** — The claim is backed by credible sources with matching evidence.
- **Mixed** — The claim is partially true or has important caveats.
- **Unsupported** — The claim contradicts available evidence or lacks credible support.
- **Cannot verify** — The claim is too vague, too recent, or lacks any reliable source coverage.

---

### Requirements

- Chrome 114 or later
- YouTube (captions must be available on the video)
- A Google AI Studio API key (free tier available)

---

### Permissions explained

- **Side panel** — displays the SourceCheck interface alongside the video without opening a new tab
- **Storage** — saves your API key preference locally on your device
- **YouTube access** — reads the live caption data from the video page (no audio recording, no video data)

---

## Screenshots needed (1280×800 or 640×400)

1. **Live scanning** — side panel open during a YouTube video, scanning card visible with pulse bars, "Live Check" label
2. **Claim verified — Supported** — hero card showing green verdict, claim text, source link
3. **Claim verified — Unsupported** — hero card showing red verdict with evidence and nuance
4. **Recent Checks stack** — 3–4 compact cards showing mixed verdicts, one expanded
5. **Settings / BYOK setup** — API key settings panel with "Remember key" toggle

Screenshots should use a real, interesting YouTube video (documentary, news clip, or science video) for authenticity. Avoid generic placeholder content.

---

## Store Tile (440×280 recommended)

Use `public/assets/logo-refined.svg` — dark background, gradient checkmark, "SourceCheck" wordmark.
Export as 440×280 PNG at 2× for retina.

---

## Additional Fields

**Homepage URL:** (add when privacy policy is hosted)

**Support URL:** https://github.com/[your-handle]/sourcecheck/issues

**Privacy Policy URL:** (see PRIVACY_POLICY.md — host at your domain before submission)

---

## Developer Notes for Review

- Extension uses `declarativeNetRequest` only for YouTube header modification (required to fetch transcript data). No requests are intercepted or blocked.
- All AI calls go through the user's own Google AI Studio key to our backend proxy. The proxy enforces rate limits and does not log transcript content.
- Content scripts run in isolated world only — no page script injection.
- CSP: `script-src 'self'; object-src 'self'` — no remote code execution possible.
