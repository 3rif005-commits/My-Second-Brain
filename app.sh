#!/usr/bin/env bash
# app.sh — start/stop the whole Second Brain stack with one command
# Usage:
#   ./app.sh start   — backend (8000) + frontend (3000) + llama.cpp servers (if set up), all in background
#   ./app.sh stop    — kill everything
#   ./app.sh status  — show what's running
#   ./app.sh logs    — tail live logs from backend + frontend

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PORT=8000
FRONTEND_PORT=3000
BACKEND_LOG="/tmp/second-brain-backend.log"
FRONTEND_LOG="/tmp/second-brain-frontend.log"
BACKEND_PID_FILE="/tmp/second-brain-backend.pid"
FRONTEND_PID_FILE="/tmp/second-brain-frontend.pid"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
info() { echo -e "${BLUE}→${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

running() {
  local pid_file=$1 port=$2
  if [[ -f "$pid_file" ]]; then
    kill -0 "$(cat "$pid_file")" 2>/dev/null && return 0
  fi
  lsof -ti ":$port" &>/dev/null && return 0
  return 1
}

kill_service() {
  local name=$1 pid_file=$2 port=$3
  if [[ -f "$pid_file" ]]; then
    local pid; pid=$(cat "$pid_file")
    kill "$pid" 2>/dev/null && ok "Stopped $name (pid $pid)"
    rm -f "$pid_file"
  fi
  local leftover; leftover=$(lsof -ti ":$port" 2>/dev/null || true)
  if [[ -n "$leftover" ]]; then
    kill $leftover 2>/dev/null || true
    ok "Cleaned up port $port"
  fi
}

cmd_start() {
  echo ""
  echo -e "${BLUE}═══ Starting Second Brain ═══${NC}"
  echo ""

  if running "$BACKEND_PID_FILE" "$BACKEND_PORT"; then
    warn "Backend already running on port $BACKEND_PORT"
  else
    info "Starting backend on port $BACKEND_PORT …"
    (cd "$BACKEND_DIR" && source .venv/bin/activate && exec uvicorn main:app --port "$BACKEND_PORT" --reload) \
      > "$BACKEND_LOG" 2>&1 &
    echo $! > "$BACKEND_PID_FILE"
    ok "Backend started (pid $(cat "$BACKEND_PID_FILE")) — logs: $BACKEND_LOG"
  fi

  if running "$FRONTEND_PID_FILE" "$FRONTEND_PORT"; then
    warn "Frontend already running on port $FRONTEND_PORT"
  else
    info "Starting frontend on port $FRONTEND_PORT …"
    (cd "$FRONTEND_DIR" && exec npm run dev) > "$FRONTEND_LOG" 2>&1 &
    echo $! > "$FRONTEND_PID_FILE"
    ok "Frontend started (pid $(cat "$FRONTEND_PID_FILE")) — logs: $FRONTEND_LOG"
  fi

  if [[ -x "$ROOT_DIR/llama.sh" ]] && [[ -f "$HOME/llama.cpp/build/bin/llama-server" ]]; then
    info "Starting local llama.cpp servers …"
    "$ROOT_DIR/llama.sh" start
  else
    warn "llama.cpp not set up — skipping (run ./llama.sh setup if you need local embeddings/LLM)"
  fi

  echo ""
  ok "Second Brain is starting up"
  echo -e "  Frontend → http://localhost:$FRONTEND_PORT"
  echo -e "  Backend  → http://localhost:$BACKEND_PORT"
  echo -e "  Logs     → ${YELLOW}./app.sh logs${NC}   Status → ${YELLOW}./app.sh status${NC}"
  echo ""
}

cmd_stop() {
  echo ""
  kill_service "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT"
  kill_service "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"
  if [[ -x "$ROOT_DIR/llama.sh" ]]; then
    "$ROOT_DIR/llama.sh" stop
  fi
  echo ""
  ok "Everything stopped"
  echo ""
}

cmd_status() {
  echo ""
  echo -e "${BLUE}═══ Second Brain Status ═══${NC}"
  echo ""
  if running "$BACKEND_PID_FILE" "$BACKEND_PORT"; then
    echo -e "  Backend   (port $BACKEND_PORT)  ${GREEN}● running${NC}"
  else
    echo -e "  Backend   (port $BACKEND_PORT)  ${RED}○ stopped${NC}"
  fi
  if running "$FRONTEND_PID_FILE" "$FRONTEND_PORT"; then
    echo -e "  Frontend  (port $FRONTEND_PORT)  ${GREEN}● running${NC}"
  else
    echo -e "  Frontend  (port $FRONTEND_PORT)  ${RED}○ stopped${NC}"
  fi
  echo ""
  if [[ -x "$ROOT_DIR/llama.sh" ]]; then
    "$ROOT_DIR/llama.sh" status
  fi
}

cmd_logs() {
  echo -e "${BLUE}→ Tailing backend + frontend logs (Ctrl+C to stop)${NC}"
  echo ""
  tail -f "$BACKEND_LOG" "$FRONTEND_LOG" 2>/dev/null || warn "No log files yet — start the app first"
}

case "${1:-help}" in
  start)  cmd_start  ;;
  stop)   cmd_stop   ;;
  status) cmd_status ;;
  logs)   cmd_logs   ;;
  *)
    echo ""
    echo -e "${BLUE}Usage:${NC} ./app.sh <command>"
    echo ""
    echo "  start    Start backend + frontend + llama.cpp (if set up) in the background"
    echo "  stop     Kill everything"
    echo "  status   Show what's running"
    echo "  logs     Tail live logs from backend + frontend"
    echo ""
    ;;
esac
