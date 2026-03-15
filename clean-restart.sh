#!/bin/bash

set -euo pipefail

echo "Cleaning backend build cache..."
cd "$(dirname "$0")/backend"

if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti:3000 2>/dev/null || true)"
  if [ -n "${PIDS}" ]; then
    echo "Stopping process(es) on port 3000: ${PIDS}"
    kill ${PIDS} 2>/dev/null || true
    sleep 1
  fi
fi

rm -rf .next
rm -rf node_modules/.cache

echo "Installing backend dependencies..."
npm install

echo "Building backend..."
npm run build

echo ""
echo "Backend cache reset complete."
echo "Run:"
echo "  cd backend && npm run dev"
