#!/usr/bin/env node
/**
 * SourceCheck Log Server
 * Receives logs from extension via HTTP POST and writes to file
 * 
 * Usage:
 *   node scripts/log-server.cjs
 * 
 * Then in Chrome console, run:
 *   localStorage.setItem('SC_LOG_ENDPOINT', 'http://localhost:9223/log')
 *   // Reload extension
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'extension.log');
const PORT = 9223;

// Ensure logs directory exists
const logsDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Clear old log
fs.writeFileSync(LOG_FILE, `=== SourceCheck Log Started ${new Date().toISOString()} ===\n\n`);

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const logEntry = JSON.parse(body);
        const line = `[${logEntry.timestamp}] [${logEntry.level}] ${logEntry.source}: ${logEntry.message}\n`;
        fs.appendFileSync(LOG_FILE, line);
        console.log(line.trim());
        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid JSON');
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Log server running on http://localhost:${PORT}`);
  console.log(`Logs written to: ${LOG_FILE}`);
  console.log('');
  console.log('To enable in Chrome:');
  console.log('  1. Open DevTools console on YouTube');
  console.log('  2. Run: localStorage.setItem("SC_LOG_ENDPOINT", "http://localhost:9223/log")');
  console.log('  3. Reload the extension');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down log server...');
  server.close();
  process.exit(0);
});
