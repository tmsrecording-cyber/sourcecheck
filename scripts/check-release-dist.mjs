import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));
const DISALLOWED_PATTERNS = [
  // Localhost / dev URLs (H2)
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://0.0.0.0',
  'https://0.0.0.0',
  '://localhost',
  '://127.0.0.1',
  '://0.0.0.0',
  '.local/',
  // External font sources (H3) - MV3 CSP prohibits remote fonts
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'googleapis.com/css',
];

const files = [];

const walk = (dirPath) => {
  for (const entry of readdirSync(dirPath)) {
    const nextPath = join(dirPath, entry);
    const stats = statSync(nextPath);
    if (stats.isDirectory()) {
      walk(nextPath);
      continue;
    }
    files.push(nextPath);
  }
};

walk(DIST_DIR);

const failures = [];

for (const filePath of files) {
  const content = readFileSync(filePath, 'utf8');
  const matchedPattern = DISALLOWED_PATTERNS.find((pattern) => content.includes(pattern));
  if (matchedPattern) {
    failures.push({ filePath, matchedPattern });
  }
}

if (failures.length > 0) {
  console.error('Release dist check failed: local/dev URL detected in built output.');
  failures.forEach(({ filePath, matchedPattern }) => {
    console.error(`- ${filePath}: found "${matchedPattern}"`);
  });
  process.exit(1);
}

console.log('Release dist check passed: no local/dev URLs found in dist.');
