#!/usr/bin/env node
/**
 * SourceCheck Log Server
 * Receives logs from extension via WebSocket and writes to file
 * Run: node scripts/log-server.js
 */

const WebSocket = require('ws');
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
fs.writeFileSync(LOG_FILE, `=== SourceCheck Log Started ${new Date().toISOString()} ===\n`);

const wss = new WebSocket.Server({ port: PORT });

console.log(`Log server running on ws://localhost:${PORT}`);
console.log(`Logs written to: ${LOG_FILE}`);

wss.on('connection', (ws) => {
  console.log('Extension connected');
  
  ws.on('message', (data) => {
    try {
      const logEntry = JSON.parse(data);
      const line = `[${logEntry.timestamp}] [${logEntry.level}] ${logEntry.source}: ${logEntry.message}\n`;
      fs.appendFileSync(LOG_FILE, line);
      
      // Also print to console
      console.log(line.trim());
    } catch (e) {
      const line = `[${new Date().toISOString()}] ${data}\n`;
      fs.appendFileSync(LOG_FILE, line);
    }
  });
  
  ws.on('close', () => {
    console.log('Extension disconnected');
  });
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down log server...');
  wss.close();
  process.exit(0);
});
