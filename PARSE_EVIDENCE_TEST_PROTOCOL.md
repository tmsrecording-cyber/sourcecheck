# PARSE_ERROR Evidence Test Protocol

## Pre-Flight (Do This First)

### 1. Verify Backend
```bash
curl http://localhost:3000/api/debug/parse-errors
```
Should return: `{"summary":{"totalErrors":0,...},...}`

### 2. Verify Extension Build
```bash
ls -la /Users/mj/Desktop/SourceCheck/dist/manifest.json
```
Should show timestamp matching latest build (Mar 18 23:43)

### 3. Clear Evidence Buffer
```bash
curl http://localhost:3000/api/debug/parse-errors?action=clear
echo "Cleared"
```

### 4. Verify Extension in Chrome
- Open `chrome://extensions`
- SourceCheck shows version 0.1.1
- Service worker status: Active
- No errors in service worker console

---

## Test Matrix (15 Videos)

### Category A: Short Clips (< 5 min)
| # | Video | Model | Transcript | Cards | HISTORY | Parse Error |
|---|-------|-------|------------|-------|---------|-------------|
| 1 | [Your pick: science explainer] | | | | | |
| 2 | [Your pick: tech review] | | | | | |
| 3 | [Your pick: news brief] | | | | | |

### Category B: Long Videos (> 30 min)
| # | Video | Model | Transcript | Cards | HISTORY | Parse Error |
|---|-------|-------|------------|-------|---------|-------------|
| 4 | [Your pick: documentary] | | | | | |
| 5 | [Your pick: podcast episode] | | | | | |
| 6 | [Your pick: lecture/interview] | | | | | |

### Category C: News/Politics
| # | Video | Model | Transcript | Cards | HISTORY | Parse Error |
|---|-------|-------|------------|-------|---------|-------------|
| 7 | [Your pick: breaking news] | | | | | |
| 8 | [Your pick: political analysis] | | | | | |
| 9 | [Your pick: fact-check video] | | | | | |

### Category D: Podcasts/Interviews
| # | Video | Model | Transcript | Cards | HISTORY | Parse Error |
|---|-------|-------|------------|-------|---------|-------------|
| 10 | [Your pick: long-form interview] | | | | | |
| 11 | [Your pick: panel discussion] | | | | | |
| 12 | [Your pick: solo podcast] | | | | | |

### Category E: Gaming
| # | Video | Model | Transcript | Cards | HISTORY | Parse Error |
|---|-------|-------|------------|-------|---------|-------------|
| 13 | [Your pick: game review] | | | | | |
| 14 | [Your pick: industry commentary] | | | | | |
| 15 | [Your pick: livestream VOD] | | | | | |

---

## Per-Video Checklist

For each video, note:

1. **Selected Model**: What model showed in header? (gemini-2.5-flash, etc.)
2. **Transcript Loaded**: Did "Live Transcript" show text?
3. **Cards Appeared**: Did any source cards generate?
4. **HISTORY Worked**: Did HISTORY tab show verified claims?
5. **Parse Error Visible**: Did you see any error toasts or "Checking failed" states?

---

## Evidence Collection

After testing all 15 videos, run:

```bash
curl http://localhost:3000/api/debug/parse-errors | jq
```

Save this output — it contains the failure distribution.

---

## Quick Analysis Commands

```bash
# Pretty-print summary
curl http://localhost:3000/api/debug/parse-errors | jq '.summary'

# Raw counts by route
curl http://localhost:3000/api/debug/parse-errors | jq '.counts'
```

---

## Success Criteria

| Scenario | Recommendation |
|----------|---------------|
| < 3 total errors, all recovered | No fallback needed |
| Errors cluster on one model (e.g., flash-lite) | Narrow retry for that model only |
| Errors spread across routes/types | Fix parser first, no fallback |
| High error rate (>20% of videos) | Urgent: schema/prompt fix needed |

---

## What to Send Me

Paste:
1. The test matrix with your notes (fill in the table)
2. The JSON output from `/api/debug/parse-errors`
3. Any observations about patterns you noticed

I'll analyze and provide the recommendation (no fallback vs narrow retry vs parser fix).
