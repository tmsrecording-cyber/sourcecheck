# Antigravity Browser Debugging Setup for SourceCheck

## ✅ Status

| Component | Status |
|-----------|--------|
| Chrome DevTools MCP | ✅ Installed |
| Antigravity Browser | ✅ Running on port 9222 |
| Build (API_BASE) | ✅ `sourcecheck.vercel.app` |
| Backend Health | ✅ Responding (403 expected without auth) |

---

## 🔧 MCP Configuration

### For Kimi Code / VS Code

Add to your MCP settings:

**Option 1: Project-level (`.mcp.json` already created)**
```bash
# The .mcp.json file in project root contains the config
```

**Option 2: User-level settings**

Create or edit `~/Library/Application Support/Code/User/mcp.json`:
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--browser-url=http://127.0.0.1:9222"
      ]
    }
  }
}
```

**Option 3: Environment variable**
```bash
export MCP_CHROME_DEVTOOLS_BROWSER_URL=http://127.0.0.1:9222
```

---

## 🚀 Quick Start

### Step 1: Verify Browser is Running
```bash
# Should return Chrome version
curl -s http://127.0.0.1:9222/json/version | grep Browser
```

### Step 2: Load Extension
1. In Antigravity Chrome, go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select `/Users/mj/Desktop/SourceCheck/dist/`

### Step 3: Test YouTube
1. Navigate to YouTube video
2. Extension sidepanel should open automatically
3. Check service worker logs in `chrome://extensions/` → SourceCheck → "service worker"

---

## 🛠️ Available MCP Tools (29 Total)

### Navigation
- `navigate({ url: string })` - Navigate to URL
- `new_page({ url?: string })` - Open new tab
- `list_pages()` - List all tabs
- `close_page({ pageId: string })` - Close tab
- `refresh()` - Reload page
- `go_back()` / `go_forward()` - Browser history

### Interaction
- `click({ selector: string })` - Click element
- `type({ selector: string, text: string })` - Type text
- `fill({ selector: string, text: string })` - Clear and type
- `hover({ selector: string })` - Hover over element
- `scroll({ direction: 'up'|'down', amount?: number })` - Scroll page

### Debugging
- `list_console_messages({ level?: 'log'|'warn'|'error' })` - Get console logs
- `get_console_message({ index: number })` - Get specific message
- `evaluate_script({ script: string })` - Run JavaScript
- `take_screenshot({ selector?: string })` - Capture screenshot
- `take_snapshot()` - Full page snapshot

### Network
- `list_network_requests()` - List all network calls
- `get_network_request({ requestId: string })` - Get request details

### Performance
- `start_recording()` - Start performance trace
- `stop_recording()` - Stop and save trace
- `lighthouse_audit({ categories?: string[] })` - Run audit

---

## 🔍 Debugging Workflow for SourceCheck

### 1. Check Service Worker Errors
```javascript
// In Antigravity Chrome DevTools or via MCP:
navigate({ url: 'chrome://extensions/' })
// Click on SourceCheck "service worker" link
list_console_messages({ level: 'error' })
```

### 2. Test Transcript Extraction
```javascript
navigate({ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' })
// Wait for page load
list_console_messages({ level: 'log' })
// Look for: "[SourceCheck] Transcript loaded: X chunks"
```

### 3. Verify API Calls
```javascript
// Navigate to YouTube video
// Then check network requests:
list_network_requests()
// Filter for api.sourcecheck.vercel.app
```

### 4. Capture Error State
```javascript
// When error occurs:
take_screenshot({ selector: '#sourcecheck-panel' })
list_console_messages({ level: 'error' })
get_network_requests()
```

---

## 🔧 Troubleshooting

### "Cannot connect to browser"
```bash
# Check if browser is running
curl http://127.0.0.1:9222/json/version

# If not running, start Antigravity Chrome:
# Click Chrome icon in Antigravity toolbar
```

### "Extension not loading"
1. Check `dist/` folder exists and has files
2. Verify `dist/manifest.json` is valid JSON
3. Check DevTools console for manifest parsing errors

### "API 403 errors"
- Expected if `CLIENT_SECRET` not configured in extension
- Check `.env.local` has `VITE_CLIENT_SECRET`
- Rebuild extension: `npm run build`

### "No transcript found"
1. Check if video has captions
2. Look for `[SourceCheck][transcript]` logs
3. Verify content script is injected (check DevTools → Sources → Content scripts)

---

## 📁 Files Created

| File | Purpose |
|------|---------|
| `.mcp.json` | MCP server configuration |
| `scripts/setup-mcp.sh` | Automated setup script |
| `src/content/remote-logger.ts` | Extension log streaming (fallback) |
| `scripts/log-server.cjs` | HTTP log server (fallback) |
| `REMOTE_DEBUGGING.md` | Fallback log debugging guide |

---

## 🎯 Next Steps

1. **Load extension** in Antigravity Chrome (`chrome://extensions/`)
2. **Test on YouTube** - Navigate to any video
3. **Verify claims** appear in sidepanel
4. **Run test matrix** if all looks good

---

## 📝 Important Notes

- **Port 9222**: Default CDP port for Antigravity browser
- **Extension ID**: Will change on each reload (unpacked extension)
- **Backend URL**: `sourcecheck.vercel.app` (verified in build)
- **Auth required**: Client secret header needed for API calls

---

**Ready to debug!** Load the extension and let's see those claims flow.
