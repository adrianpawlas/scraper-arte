#!/bin/bash
# ===================================================
#  Arte Antwerp Scraper — Automated Run Script
#  Designed for both manual execution and cron jobs.
# ===================================================

set -euo pipefail

# --- Configuration ---
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/scraper_$(date '+%Y-%m-%d_%H-%M-%S').log"
NODE_BIN="$(command -v node || true)"
PYTHON_BIN="$(command -v python3 || true)"
NPM_BIN="$(command -v npm || true)"

# Ensure logs directory exists
mkdir -p "${LOG_DIR}"

# Redirect all output to log file AND terminal
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "=============================================="
echo "  Arte Antwerp Scraper — $(date)"
echo "=============================================="
echo ""
echo "Project directory: ${PROJECT_DIR}"

# --- Dependency Checks ---
if [ -z "${NODE_BIN}" ]; then
    echo "❌ ERROR: node not found in PATH. Please install Node.js."
    exit 1
fi
echo "✅ Node.js: $(${NODE_BIN} --version)"

if [ -z "${NPM_BIN}" ]; then
    echo "❌ ERROR: npm not found in PATH."
    exit 1
fi
echo "✅ npm: $(${NPM_BIN} --version)"

if [ -z "${PYTHON_BIN}" ]; then
    echo "⚠ WARNING: python3 not found. Embeddings will be skipped."
fi

# --- Change to project directory ---
cd "${PROJECT_DIR}"

# --- Load environment variables ---
if [ -f ".env" ]; then
    echo "✅ .env file found"
    export $(grep -v '^\s*#' .env | grep -v '^\s*$' | xargs)
else
    echo "❌ ERROR: .env file not found at ${PROJECT_DIR}/.env"
    exit 1
fi

# --- Validate required env vars ---
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
    echo "❌ ERROR: SUPABASE_URL or SUPABASE_ANON_KEY not set in .env"
    exit 1
fi
echo "✅ Environment variables loaded"

# --- Install JS dependencies if needed ---
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    ${NPM_BIN} ci --omit=dev 2>&1 || ${NPM_BIN} install --omit=dev 2>&1
    echo "✅ Dependencies installed"
else
    echo "✅ Node.js dependencies already installed"
fi

# --- Install Python dependencies if needed ---
if [ -n "${PYTHON_BIN}" ] && [ -f "requirements.txt" ]; then
    echo "🐍 Checking Python dependencies..."
    ${PYTHON_BIN} -c "import torch, transformers, PIL, requests" 2>/dev/null && \
        echo "✅ Python dependencies already installed" || {
        echo "📦 Installing Python dependencies..."
        ${PYTHON_BIN} -m pip install -r requirements.txt 2>&1
        echo "✅ Python dependencies installed"
    }
fi

# --- Ensure Playwright browser is available (idempotent - skips if already cached) ---
echo "🎭 Ensuring Playwright browser is installed..."
${NPM_BIN} exec playwright install chromium 2>&1
echo "✅ Playwright browser ready"

# --- Build TypeScript ---
echo "🔨 Building TypeScript..."
${NPM_BIN} run build 2>&1
echo "✅ Build complete"

# --- Run the scraper ---
echo ""
echo "🚀 Starting scraper..."
echo ""
${NODE_BIN} dist/index.js 2>&1
EXIT_CODE=$?

# --- Done ---
echo ""
echo "=============================================="
if [ ${EXIT_CODE} -eq 0 ]; then
    echo "  ✅ Scraper completed successfully"
else
    echo "  ❌ Scraper failed with exit code ${EXIT_CODE}"
fi
echo "  Log saved to: ${LOG_FILE}"
echo "=============================================="

exit ${EXIT_CODE}
