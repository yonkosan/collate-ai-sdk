#!/usr/bin/env bash
# DataPulse — One-command demo launcher
# Usage: ./run_demo.sh           (React UI, default)
#        ./run_demo.sh --classic  (Streamlit UI)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

UI_MODE="react"
if [[ "${1:-}" == "--classic" ]]; then
    UI_MODE="streamlit"
fi

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

banner() {
    echo ""
    echo -e "${BLUE}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}${BOLD}║    🔴 DataPulse — AI Data Incident Command Center   ║${NC}"
    echo -e "${BLUE}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
}

step() {
    echo -e "\n${BOLD}[$1/$2]${NC} ${GREEN}$3${NC}"
}

banner

# ─── Preflight checks ──────────────────────────────────────────────────────────

step 1 5 "Checking prerequisites…"

if ! command -v python3 &>/dev/null; then
    echo -e "${RED}✗ python3 not found. Install Python 3.9+.${NC}"
    exit 1
fi

PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "  ✓ Python $PY_VERSION"

if ! command -v docker &>/dev/null; then
    echo -e "${RED}✗ docker not found. Install Docker Desktop.${NC}"
    exit 1
fi
echo "  ✓ Docker available"

# Check OpenMetadata is running
if ! curl -sf http://localhost:8585/api/v1/system/version &>/dev/null; then
    echo -e "${YELLOW}⚠ OpenMetadata not reachable at localhost:8585${NC}"
    echo -e "${YELLOW}  Start it with: docker compose -f docker/development/docker-compose.yml up -d${NC}"
    echo -e "${YELLOW}  Continuing anyway (dashboard will work, pipeline needs OM)…${NC}"
fi

# Check .env exists
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}⚠ No .env file found — copying from .env.example${NC}"
        cp .env.example .env
        echo -e "${YELLOW}  Edit .env with your tokens before running the pipeline.${NC}"
    else
        echo -e "${RED}✗ No .env or .env.example found.${NC}"
        exit 1
    fi
fi
echo "  ✓ .env configured"

# ─── Install dependencies ──────────────────────────────────────────────────────

step 2 5 "Installing dependencies…"
pip3 install -q -r requirements.txt 2>&1 | tail -1
echo "  ✓ Dependencies installed"

# ─── Provision MySQL ────────────────────────────────────────────────────────────

step 3 5 "Provisioning MySQL tables with demo data…"
if python3 -m bootstrap.provision_mysql 2>&1; then
    echo -e "  ${GREEN}✓ MySQL provisioned${NC}"
else
    echo -e "  ${YELLOW}⚠ MySQL provisioning failed (may already exist)${NC}"
fi

# ─── Provision OpenMetadata ─────────────────────────────────────────────────────

step 4 5 "Registering entities, lineage, and DQ tests in OpenMetadata…"
if python3 -m bootstrap.provision_metadata 2>&1; then
    echo -e "  ${GREEN}✓ OpenMetadata provisioned${NC}"
else
    echo -e "  ${YELLOW}⚠ Metadata provisioning failed (may already exist)${NC}"
fi

# ─── Launch dashboard ──────────────────────────────────────────────────────────

step 5 5 "Launching dashboard…"
echo ""

if [[ "$UI_MODE" == "react" ]]; then
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  API Server:  ${BLUE}http://localhost:8000${NC}"
    echo -e "${BOLD}  Dashboard:   ${BLUE}http://localhost:3001${NC}"
    echo -e "${BOLD}  Click 'Run Pipeline' to scan for incidents${NC}"
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Install web UI deps if needed
    if [ ! -d web/node_modules ]; then
        echo "  Installing React UI dependencies…"
        (cd web && npm install --silent)
    fi

    # Start FastAPI backend in background
    python3 -m uvicorn api.server:app --host 0.0.0.0 --port 8000 &
    API_PID=$!
    trap "kill $API_PID 2>/dev/null" EXIT

    # Wait for API to be ready
    for i in $(seq 1 10); do
        if curl -sf http://localhost:8000/api/health &>/dev/null; then
            break
        fi
        sleep 1
    done

    # Start React dev server
    (cd web && npx vite --host 0.0.0.0 --port 3001)
else
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  Dashboard: ${BLUE}http://localhost:8501${NC}"
    echo -e "${BOLD}  Click '▶ Run Full Pipeline' to start the incident scan${NC}"
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    python3 -m streamlit run ui/app.py \
        --server.port 8501 \
        --server.headless true \
        --browser.gatherUsageStats false
fi
