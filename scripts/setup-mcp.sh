#!/bin/bash
# SourceCheck MCP Setup Script
# Sets up Chrome DevTools MCP for Antigravity browser debugging

echo "=== SourceCheck MCP Setup ==="
echo ""

# Check if chrome-devtools-mcp is already installed
if npx chrome-devtools-mcp --help 2>/dev/null | grep -q "Usage"; then
    echo "✅ chrome-devtools-mcp is already available"
else
    echo "📦 Installing chrome-devtools-mcp..."
    npx -y chrome-devtools-mcp@latest --help > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ chrome-devtools-mcp installed successfully"
    else
        echo "❌ Failed to install chrome-devtools-mcp"
        exit 1
    fi
fi

echo ""
echo "=== MCP Configuration ==="
echo ""
echo "Add this to your MCP settings (VS Code/Kimi Code/Antigravity):"
echo ""
cat << 'EOF'
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
EOF

echo ""
echo "=== Testing Connection ==="
echo ""

# Test if Antigravity browser is running on port 9222
if curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    echo "✅ Antigravity browser detected on port 9222"
    echo "   Browser version:"
    curl -s http://127.0.0.1:9222/json/version | grep -o '"Browser": "[^"]*"' | head -1
else
    echo "⚠️  No browser detected on port 9222"
    echo "   To start Antigravity browser:"
    echo "   1. Click the Chrome icon in Antigravity toolbar"
    echo "   2. Or run: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222"
fi

echo ""
echo "=== Available MCP Tools ==="
echo ""
echo "Once connected, these tools are available:"
echo "  🌐 Navigation: navigate, new_page, list_pages, close_page, refresh"
echo "  🖱️  Interaction: click, type, fill, hover, scroll, drag"
echo "  🐛 Debugging:  list_console_messages, get_console_message, evaluate_script"
echo "  📸 Visual:     take_screenshot, take_snapshot"
echo "  🌐 Network:    list_network_requests, get_network_request"
echo "  📊 Performance: start_recording, stop_recording, lighthouse_audit"
echo ""
echo "=== Example Usage ==="
echo ""
echo "1. Navigate to YouTube:"
echo "   navigate({ url: 'https://www.youtube.com/watch?v=...' })"
echo ""
echo "2. Get console errors:"
echo "   list_console_messages({ level: 'error' })"
echo ""
echo "3. Take screenshot:"
echo "   take_screenshot({})"
echo ""
echo "4. Load extension:"
echo "   navigate({ url: 'chrome://extensions/' })"
echo "   click({ selector: '[aria-label=\"Developer mode\"]' })"
echo "   click({ selector: 'text=Load unpacked' })"
echo ""
