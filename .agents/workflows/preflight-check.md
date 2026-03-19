---
description: Pre-flight check before any debugging or code changes
---

# Pre-Flight Check Workflow

**MANDATORY**: Run this workflow BEFORE investigating any bug or making any code change.
This prevents wasting time on code-level debugging when the issue is infrastructure.

## Canonical Pre-Flight Gates (ALL must pass)

Before any deeper debugging, handoff, or release work:

1. **Backend/Host Reachable** — `curl` to `/api/session/init` returns HTTP 403 (or expected response)
2. **Runtime Healthy** — Backend not hung/stuck; no LevelDB corruption; no stuck processes
3. **Build Folder Fresh** — `dist/` or equivalent exists AND timestamp matches latest source
4. **No Stale Artifacts** — Build output reflects current code; no phantom files from earlier commits

**Failure mode**: If any gate fails, STOP. Fix infrastructure first. Do not proceed to code-level debugging.

## Steps

// turbo-all

### 1. Check if the backend is running and responding

```bash
curl -s -m 5 -o /dev/null -w "%{http_code}" http://localhost:3000/api/session/init -X POST -H "Content-Type: application/json" -d '{"extensionId":"test"}'
```

**Expected**: HTTP 403 (unauthorized test ID) — means backend is alive.
**If timeout/connection refused**: Backend is down. Go to step 2.
**If hanging (0 bytes)**: Backend is STUCK. Kill it and go to step 2.

### 2. Restart the backend (if needed)

```bash
pkill -9 -f "next" 2>/dev/null
sleep 1
rm -rf /Users/mj/Desktop/SourceCheck/backend/.next
cd /Users/mj/Desktop/SourceCheck/backend && npm run dev > /tmp/backend-dev.log 2>&1 &
sleep 8
curl -s -m 5 http://localhost:3000/api/session/init -X POST -H "Content-Type: application/json" -d '{"extensionId":"test"}'
```

The `.next` cache MUST be deleted if the backend was stuck. Next.js LevelDB caches can corrupt.

### 3. Check backend logs for errors

```bash
tail -30 /tmp/backend-dev.log
```

**Red flags**:
- `ENOENT: middleware-manifest.json` → corrupted cache, delete `.next/`
- `Persisting failed: Another write batch` → corrupted LevelDB cache
- `GEMINI_API_KEY` missing → check `backend/.env.local`
- `QUOTA_EXHAUSTED` → API key quota hit

### 4. Check extension build is current

```bash
ls -la /Users/mj/Desktop/SourceCheck/dist/manifest.json 2>/dev/null && echo "dist exists" || echo "NO DIST - run npm run build"
```

**CRITICAL**: Verify the build timestamp matches your latest source changes:
```bash
stat -c "%y" /Users/mj/Desktop/SourceCheck/dist/manifest.json 2>/dev/null || stat -f "%Sm" /Users/mj/Desktop/SourceCheck/dist/manifest.json
```

If the timestamp is older than your last edit, **rebuild**:
```bash
cd /Users/mj/Desktop/SourceCheck && npm run build
```

**Stale build symptom**: Debugging shows old behavior, console logs don't match source, or "ghost" bugs reappear.

### 5. Verify the full pipeline with service worker logs

Open `chrome://extensions` → SourceCheck → "service worker" link → Console.
Look for:
- `[Pipeline] processPlayback called:` — confirms playback is being processed
- `[Pipeline] ANALYZE CHUNK START:` — confirms API calls are being made
- `[Pipeline] API Response:` — confirms backend responded
- `[Pipeline] Claims extracted` — confirms claims were found
- `[SourceCheck/SW][CARD DEBUG] Card added` — confirms cards were created

**If `processPlayback` logs show but no `ANALYZE CHUNK START`**: Rate limiting or insufficient text
**If `ANALYZE CHUNK START` shows but no `API Response`**: Backend timeout (check step 1)
**If `API Response` shows `hasClaim: false` repeatedly**: Normal — video may lack factual claims
**If `Claims extracted` shows but no `Card added`**: Client filtering too aggressive

## Common Gotchas

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Monitoring" but no cards | Backend down/hung | Steps 1-2 |
| Cards appear then disappear | Service worker restart | Reload extension |
| "Transcript unavailable" | YouTube page not ready | Refresh YouTube tab |
| 401 errors in SW console | Stale session token | Will auto-refresh |
| No transcript preview | Content script not injected | Reload YouTube tab |
