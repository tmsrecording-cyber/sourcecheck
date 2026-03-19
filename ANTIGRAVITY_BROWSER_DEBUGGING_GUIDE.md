# Antigravity Browser Subagent & Chrome DevTools Debugging Guide

> **Enabling Full Browser Debugging for Chrome Extension (MV3) Development in Google Antigravity**

---

## Table of Contents

1. [Overview](#overview)
2. [How the Browser Subagent Works](#how-the-browser-subagent-works)
3. [Enabling the Browser Subagent](#enabling-the-browser-subagent)
4. [Installing Chrome DevTools MCP](#installing-chrome-devtools-mcp)
5. [Available Capabilities](#available-capabilities)
6. [Chrome Extension Debugging Workflow](#chrome-extension-debugging-workflow)
7. [Service Worker Debugging](#service-worker-debugging)
8. [Sidepanel Inspection](#sidepanel-inspection)
9. [Troubleshooting](#troubleshooting)

---

## Overview

Google Antigravity includes a built-in **Browser Subagent** that provides AI agents with direct access to a Chrome browser instance via the **Chrome DevTools Protocol (CDP)** on port `9222`. This enables:

- Console log reading
- DOM inspection
- Screenshots and video recording
- Network monitoring
- Chrome Extension debugging (MV3)

The user screenshot showing a SourceCheck service worker error with a "View in DevTools" button confirms Antigravity has detected an error in the extension's service worker and is offering to open Chrome DevTools for debugging.

---

## How the Browser Subagent Works

When active, Antigravity spawns a browser subagent with access to:

### Interaction Tools
- Clicking buttons and links
- Scrolling pages
- Typing into input fields
- Selecting dropdown options
- Hovering over elements

### Reading Tools
- DOM capture and analysis
- Screenshot capture
- Markdown page parsing
- **Console log reading**
- **Network request inspection**

### Recording Tools
- Video recording of sessions
- Step-by-step screenshot sequences
- Action timeline capture
- Performance metrics logging

### Browser Subagent Process
```
/opt/google/chrome/chrome --type=renderer 
  --user-data-dir=/home/user/.gemini/antigravity-browser-profile
  --remote-debugging-port=9222
  --ozone-platform=x11
  --lang=en-US
  ...
```

**Default Profile Path:** `~/.gemini/antigravity-browser-profile`

---

## Enabling the Browser Subagent

### Step 1: Launch Antigravity's Built-in Browser

1. Open **Google Antigravity IDE**
2. Look for the **Chrome icon** in the top toolbar
3. Click it to launch the browser subagent

> **Note:** The first time you use browser features, you'll be prompted to install the **Google Antigravity Chrome Extension** from the Chrome Web Store.

### Step 2: Verify Browser is Running

Test that port 9222 is active:

```bash
# Check if port 9222 is listening
lsof -i :9222

# Or test the CDP endpoint
curl -s http://localhost:9222/json | jq '.[] | select(.type == "page") | {title, url}'
```

Expected output:
```json
{
  "title": "New Tab",
  "url": "chrome://newtab/"
}
```

### Step 3: Access Browser Settings (Optional)

Configure advanced browser options:

1. Open Antigravity **Settings**
2. Navigate to **Browser > Advanced**
3. Configure:
   - **Chrome Binary Path:** Default is `chrome` (can use `brave`, `chromium`, etc.)
   - **Browser User Profile Path:** Default is `antigravity-browser-profile`
   - **Browser CDP Port:** Default is `9222`

---

## Installing Chrome DevTools MCP

To enable full DevTools capabilities within Antigravity, install the **Chrome DevTools MCP server**.

### MCP Configuration for Antigravity

Add to your MCP servers config (location varies by setup):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--browser-url=http://127.0.0.1:9222",
        "-y"
      ]
    }
  }
}
```

> **Important:** This connects to Antigravity's built-in browser. The browser must already be running (click the Chrome icon in Antigravity toolbar).

### Configuration Locations

Depending on your Antigravity setup:

| Setup | Config Location |
|-------|-----------------|
| VS Code Extension | `~/.vscode/mcp.json` or workspace settings |
| Cline | Settings → MCP |
| Claude Code | `~/.claude/mcp.json` |
| Standalone | Antigravity Settings → MCP |

### Alternative: Using `--autoConnect` (Chrome 144+)

For automatic connection without specifying port:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--autoConnect"
      ]
    }
  }
}
```

---

## Available Capabilities

Once Chrome DevTools MCP is configured, you have access to these tools:

### Input Automation (9 tools)
- `click` - Click elements
- `drag` - Drag and drop
- `fill` - Fill input fields
- `fill_form` - Fill entire forms
- `handle_dialog` - Handle alerts/confirm/prompt
- `hover` - Hover over elements
- `press_key` - Press keyboard keys
- `type_text` - Type text
- `upload_file` - Upload files

### Navigation (6 tools)
- `close_page` - Close tabs
- `list_pages` - List all tabs
- `navigate_page` - Navigate to URL
- `new_page` - Open new tab
- `select_page` - Switch tabs
- `wait_for` - Wait for conditions

### Debugging (6 tools)
- `evaluate_script` - Execute JavaScript
- `get_console_message` - Read console logs
- `lighthouse_audit` - Run performance audit
- `list_console_messages` - List all console messages
- `take_screenshot` - Capture screenshots
- `take_snapshot` - DOM snapshot

### Network (2 tools)
- `get_network_request` - Inspect specific requests
- `list_network_requests` - List all network activity

### Performance (4 tools)
- `performance_analyze_insight` - Performance analysis
- `performance_start_trace` - Start performance trace
- `performance_stop_trace` - Stop performance trace
- `take_memory_snapshot` - Memory profiling

### Emulation (2 tools)
- `emulate` - Device emulation
- `resize_page` - Viewport resizing

---

## Chrome Extension Debugging Workflow

### Loading an Unpacked Extension

1. **Start Antigravity Browser**
   - Click the Chrome icon in Antigravity toolbar

2. **Navigate to Extensions Page**
   ```
   chrome://extensions/
   ```

3. **Enable Developer Mode**
   - Toggle "Developer mode" switch (top-right)

4. **Load Extension**
   - Click **"Load unpacked"**
   - Select your `dist/` folder (for SourceCheck: `/Users/mj/Desktop/SourceCheck/dist`)

5. **Verify Extension Loaded**
   - Extension should appear in the list
   - Note the **Extension ID** (e.g., `abcd1234efgh5678`)

### Extension-Specific URLs

| Purpose | URL |
|---------|-----|
| Extensions page | `chrome://extensions/` |
| Service Worker DevTools | `chrome://extensions/?id=YOUR_EXTENSION_ID` → Click "service worker" |
| Extension background page | `chrome-extension://YOUR_EXTENSION_ID/background.html` |
| Side panel | `chrome-extension://YOUR_EXTENSION_ID/src/sidepanel.html` |

---

## Service Worker Debugging

### Method 1: Via chrome://extensions

1. Navigate to `chrome://extensions/`
2. Find your extension (SourceCheck)
3. Click **"service worker"** link
4. This opens DevTools dedicated to the service worker context

### Method 2: Via Antigravity's "View in DevTools" Button

When Antigravity detects a service worker error, it displays:
- Error message summary
- **"View in DevTools"** button

Clicking opens DevTools directly to the error location.

### Method 3: Using Chrome DevTools MCP

Query service worker console logs via MCP:

```javascript
// List all console messages
list_console_messages({
  level: "error"
})

// Evaluate script in service worker context
evaluate_script({
  script: "chrome.runtime.getManifest()"
})
```

### Accessing Service Worker Logs via CDP Directly

```bash
# Get list of targets (includes service workers)
curl -s http://localhost:9222/json/list

# Look for type: "service_worker" in the response
```

---

## Sidepanel Inspection

### Opening Sidepanel DevTools

1. **Navigate directly to sidepanel URL:**
   ```
   chrome-extension://YOUR_EXTENSION_ID/src/sidepanel.html
   ```

2. **Open DevTools:**
   - Press `F12` or `Cmd+Option+I` (Mac)
   - Or right-click → Inspect

3. **Using MCP:**
   ```javascript
   // Navigate to sidepanel
   navigate_page({
     url: "chrome-extension://YOUR_EXTENSION_ID/src/sidepanel.html"
   })
   
   // Take screenshot of sidepanel
   take_screenshot({
     fullPage: true
   })
   ```

### Inspecting Sidepanel Elements

```javascript
// Get DOM snapshot
take_snapshot()

// Evaluate React component state
evaluate_script({
  script: "
    const root = document.querySelector('#root');
    return {
      childCount: root.children.length,
      html: root.innerHTML.substring(0, 1000)
    };
  "
})
```

---

## Project-Specific Debugging (SourceCheck)

### Remote Logging Setup (Already Configured)

SourceCheck has a remote logger at `src/content/remote-logger.ts`:

```bash
# 1. Start the log server
node scripts/log-server.cjs

# 2. In Chrome DevTools console:
localStorage.setItem('SC_LOG_ENDPOINT', 'http://localhost:9223/log')

# 3. Reload extension
```

### Using Chrome DevTools MCP with SourceCheck

```javascript
// Navigate to YouTube with extension active
navigate_page({ url: "https://www.youtube.com/watch?v=EXAMPLE" })

// Wait for page load
wait_for({ state: "networkidle" })

// Check console for SourceCheck logs
list_console_messages({ level: "log" })

// Take screenshot of sidepanel
take_screenshot()

// Evaluate in content script context
evaluate_script({
  script: "
    // Check if SourceCheck content script is injected
    window.__scRemoteLogger ? 'Content script active' : 'Not loaded'
  "
})
```

---

## Troubleshooting

### Port 9222 Already in Use

If port 9222 is occupied:

```bash
# Find process using port 9222
lsof -i :9222

# Kill existing Chrome instances
pkill -f "antigravity-browser-profile"

# Or use a different port (requires MCP config update)
```

### Extension Not Appearing

1. Ensure Developer Mode is enabled
2. Check `dist/` folder contains valid `manifest.json`
3. Verify manifest version is compatible (MV3)

### Service Worker Not Starting

1. Check `chrome://extensions/` for errors
2. Click "service worker" link to view DevTools
3. Check for syntax errors in `service-worker.ts`

### MCP Connection Failed

```bash
# Test CDP endpoint manually
curl http://localhost:9222/json/version

# Should return version info
```

### Using Alternative Port (9333)

If 9222 conflicts with other tools:

1. **Launch Antigravity with different port:**
   ```bash
   # macOS
   open -a "Antigravity" --args --remote-debugging-port=9333
   ```

2. **Update MCP config:**
   ```json
   {
     "args": [
       "chrome-devtools-mcp@latest",
       "--browser-url=http://127.0.0.1:9333"
     ]
   }
   ```

---

## Quick Reference Commands

```bash
# Check browser is running
curl http://localhost:9222/json/list | jq '.[].url'

# List all tabs/pages
curl http://localhost:9222/json | jq '.[] | {id, title, type, url}'

# Kill all Antigravity browser processes
pkill -f "antigravity-browser-profile"

# Start log server for SourceCheck
cd /Users/mj/Desktop/SourceCheck && node scripts/log-server.cjs
```

---

## Summary

| Feature | How to Access |
|---------|--------------|
| Launch Browser | Click Chrome icon in Antigravity toolbar |
| Service Worker DevTools | `chrome://extensions/` → Click "service worker" link |
| Sidepanel DevTools | Navigate to `chrome-extension://ID/src/sidepanel.html` → F12 |
| Console Logs | Chrome DevTools MCP `list_console_messages` |
| Screenshots | Chrome DevTools MCP `take_screenshot` |
| Network Monitoring | Chrome DevTools MCP `list_network_requests` |
| Extension Errors | Antigravity shows "View in DevTools" button automatically |

---

## Related Files in Project

- `REMOTE_DEBUGGING.md` - SourceCheck remote logging setup
- `src/content/remote-logger.ts` - Content script logger
- `scripts/log-server.cjs` - Log server for console capture
- `src/background/service-worker.ts` - Service worker to debug
- `src/sidepanel/` - Sidepanel React components

---

*Last updated: March 19, 2026*
