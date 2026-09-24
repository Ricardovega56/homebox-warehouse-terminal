#!/usr/bin/env bash
# ==============================================================================
# Pre-Flight Verification Script for Homebox Warehouse Terminal
# Runs all type checks, unit tests, and production build pipelines.
# Enforced prior to git push to eliminate regressions before production deploy.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

echo "=========================================================="
echo " [1/4] Running Frontend Type Checks (svelte-check)..."
echo "=========================================================="
npm --prefix frontend run check

echo ""
echo "=========================================================="
echo " [2/4] Running Frontend Unit Tests (Vitest)..."
echo "=========================================================="
npm --prefix frontend test

echo ""
echo "=========================================================="
echo " [3/4] Running Relay Python Unit Tests (pytest)..."
echo "=========================================================="
if [ -f "relay/.venv/bin/pytest" ]; then
    relay/.venv/bin/pytest relay/test_relay.py -q
else
    pytest relay/test_relay.py -q
fi

echo ""
echo "=========================================================="
echo " [4/4] Building Frontend Production Bundle (Vite)..."
echo "=========================================================="
npm --prefix frontend run build

echo ""
echo "=========================================================="
echo " ✅ ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!"
echo " Safe to deploy."
echo "=========================================================="
