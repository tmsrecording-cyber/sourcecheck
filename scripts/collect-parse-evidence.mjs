#!/usr/bin/env node
/**
 * PARSE_ERROR Evidence Collection Script
 * 
 * Runs a controlled test across video categories and collects evidence.
 * 
 * Usage:
 *   node scripts/collect-parse-evidence.mjs [extensionId]
 * 
 * This script:
 * 1. Opens the sidepanel debug view
 * 2. Monitors parse error evidence endpoint
 * 3. Reports failure rates by model and route
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const EXTENSION_ID = process.argv[2] || process.env.EXTENSION_ID;
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

if (!EXTENSION_ID) {
  console.error('Usage: node scripts/collect-parse-evidence.mjs <extensionId>');
  console.error('Or set EXTENSION_ID environment variable');
  process.exit(1);
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     PARSE_ERROR Evidence Collection — SourceCheck          ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log(`║ Extension: ${EXTENSION_ID.slice(0, 20)}...                    ║`);
console.log(`║ API: ${API_BASE}                                    ║`);
console.log('╚════════════════════════════════════════════════════════════╝');
console.log();

// Clear existing evidence
console.log('Clearing existing evidence...');
try {
  await fetch(`${API_BASE}/api/debug/parse-errors?action=clear`);
  console.log('✓ Evidence buffer cleared');
} catch (e) {
  console.log('⚠ Could not clear evidence (endpoint may not be available)');
}

console.log();
console.log('Evidence collection ready. To gather data:');
console.log();
console.log('1. Open Chrome with the extension loaded');
console.log('2. Navigate to test videos:');
console.log('   - Short clips (< 5 min)');
console.log('   - Long videos (> 30 min)');
console.log('   - News/politics content');
console.log('   - Podcasts/interviews');
console.log('   - Gaming content');
console.log();
console.log('3. Let each video run for 2-3 minutes to generate claims');
console.log('4. Run this command to check evidence:');
console.log(`   curl ${API_BASE}/api/debug/parse-errors`);
console.log();
console.log('5. When done, view summary:');
console.log(`   curl ${API_BASE}/api/debug/parse-errors | jq '.summary'`);
console.log();

// If --watch flag, poll the endpoint
if (process.argv.includes('--watch')) {
  console.log('Starting watch mode (polling every 10s)...');
  console.log();
  
  setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/debug/parse-errors`);
      const data = await res.json();
      
      if (data.summary?.totalErrors > 0) {
        console.clear();
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║              PARSE_ERROR Evidence Summary                  ║');
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log(`║ Total Errors: ${data.summary.totalErrors.toString().padEnd(49)} ║`);
        console.log(`║ Recovery Rate: ${(data.summary.recoveryRate + '%').padEnd(48)} ║`);
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log('║ By Route:                                                  ║');
        Object.entries(data.summary.byRoute || {}).forEach(([route, count]) => {
          console.log(`║   ${route.padEnd(54)} ${count.toString().padEnd(3)} ║`);
        });
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log('║ By Model:                                                  ║');
        Object.entries(data.summary.byModel || {}).forEach(([model, count]) => {
          console.log(`║   ${model.padEnd(54)} ${count.toString().padEnd(3)} ║`);
        });
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log('║ By Type:                                                   ║');
        Object.entries(data.summary.byType || {}).forEach(([type, count]) => {
          console.log(`║   ${type.padEnd(54)} ${count.toString().padEnd(3)} ║`);
        });
        console.log('╚════════════════════════════════════════════════════════════╝');
      }
    } catch (e) {
      // Silent fail in watch mode
    }
  }, 10000);
}
