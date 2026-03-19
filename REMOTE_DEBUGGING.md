# Remote Debugging Setup

This lets me (the AI) read your Chrome console logs without you taking screenshots.

## One-Time Setup

### Step 1: Start the Log Server

```bash
cd /Users/mj/Desktop/SourceCheck
node scripts/log-server.cjs
```

You'll see:
```
Log server running on http://localhost:9223
Logs written to: /Users/mj/Desktop/SourceCheck/logs/extension.log
```

### Step 2: Enable in Chrome

1. Open YouTube with SourceCheck running
2. Open DevTools (F12) → Console
3. Paste this:
   ```javascript
   localStorage.setItem('SC_LOG_ENDPOINT', 'http://localhost:9223/log');
   ```
4. Reload the extension at `chrome://extensions` → click reload button on SourceCheck

### Step 3: That's It

Now all `[SourceCheck]` logs automatically stream to the log file.

## Reading Logs

I can now read your logs with:
```bash
tail -n 100 /Users/mj/Desktop/SourceCheck/logs/extension.log
```

Or read the full file to see everything.

## Troubleshooting

**Logs not appearing?**
- Check log server is running (Step 1)
- Check `localStorage.getItem('SC_LOG_ENDPOINT')` returns the URL
- Reload extension after setting the localStorage key

**Port already in use?**
- Change `PORT` in `scripts/log-server.cjs` to something else (e.g., 9224)
- Update the localStorage URL to match

## Disable

To stop remote logging:
```javascript
localStorage.removeItem('SC_LOG_ENDPOINT');
```

Then reload the extension.
