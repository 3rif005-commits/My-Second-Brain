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
MCP_PORT=8765          # the remote MCP server — the only port a tunnel exposes
BACKEND_LOG="/tmp/second-brain-backend.log"
FRONTEND_LOG="/tmp/second-brain-frontend.log"
BACKEND_PID_FILE="/tmp/second-brain-backend.pid"
FRONTEND_PID_FILE="/tmp/second-brain-frontend.pid"
MCP_LOG="/tmp/second-brain-mcp.log"
MCP_PID_FILE="/tmp/second-brain-mcp.pid"
# The public address the tunnel gives (./app.sh tunnel writes it here).
MCP_URL_FILE="$HOME/.secondbrain/mcp-public-url"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
info() { echo -e "${BLUE}→${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

port_busy() {
  ss -ltnH "sport = :$1" 2>/dev/null | grep -q . && return 0
  lsof -ti ":$1" &>/dev/null
}

# Wait until nothing listens on the port. `stop` used to return while uvicorn
# was still shutting down; the next `start` saw the port busy, printed
# "Backend already running" and skipped it — and the app answered 500.
wait_port_free() {
  local port=$1 name=$2 i
  for i in $(seq 1 30); do
    port_busy "$port" || return 0
    sleep 0.5
  done
  local stuck; stuck=$( (lsof -ti ":$port" 2>/dev/null; ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2) | sort -u | tr '\n' ' ')
  if [[ -n "$stuck" ]]; then
    kill -9 $stuck 2>/dev/null || true
    sleep 1
  fi
  port_busy "$port" && { warn "$name: port $port is still in use"; return 1; }
  return 0
}

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
    # Each service is started in its own process group (setsid), so stopping
    # the group stops its children too — `npm run dev` leaves a next-server
    # grandchild that outlived a plain `kill <pid>`.
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    ok "Stopped $name (pid $pid)"
    rm -f "$pid_file"
  fi
  local leftover; leftover=$( (lsof -ti ":$port" 2>/dev/null; ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2) | sort -u | tr '\n' ' ')
  if [[ -n "$leftover" ]]; then
    kill $leftover 2>/dev/null || true
    ok "Cleaned up port $port"
  fi
  wait_port_free "$port" "$name"
}

cmd_start() {
  echo ""
  echo -e "${BLUE}═══ Starting Second Brain ═══${NC}"
  echo ""

  if running "$BACKEND_PID_FILE" "$BACKEND_PORT"; then
    warn "Backend already running on port $BACKEND_PORT"
  else
    info "Starting backend on port $BACKEND_PORT …"
    # The child writes its own pid: it is the new process group's leader, so
    # stop can end the whole group (setsid may fork, making $! the wrong pid).
    setsid bash -c "echo \$\$ > '$BACKEND_PID_FILE'; cd '$BACKEND_DIR' && source .venv/bin/activate && exec uvicorn main:app --port '$BACKEND_PORT' --reload" \
      > "$BACKEND_LOG" 2>&1 < /dev/null &
    # Say "started" only once it answers — a backend that died on start
    # used to be reported as started, and the app showed errors.
    local i up=0
    for i in $(seq 1 40); do
      curl -s -o /dev/null "http://localhost:$BACKEND_PORT/health" && { up=1; break; }
      sleep 0.5
    done
    if [[ $up -eq 1 ]]; then
      ok "Backend started (pid $(cat "$BACKEND_PID_FILE")) — logs: $BACKEND_LOG"
    else
      warn "Backend did not answer after 20s — see: tail -30 $BACKEND_LOG"
    fi
  fi

  if running "$MCP_PID_FILE" "$MCP_PORT"; then
    warn "MCP server already running on port $MCP_PORT"
  else
    local public="http://localhost:$MCP_PORT"
    [[ -f "$MCP_URL_FILE" ]] && public="$(cat "$MCP_URL_FILE")"
    setsid bash -c "echo \$\$ > '$MCP_PID_FILE'; cd '$BACKEND_DIR' && source .venv/bin/activate && MCP_PUBLIC_URL='$public' exec uvicorn mcp_remote.server:app --port '$MCP_PORT'" \
      > "$MCP_LOG" 2>&1 < /dev/null &
    ok "MCP server started (port $MCP_PORT, public address $public) — logs: $MCP_LOG"
  fi

  if running "$FRONTEND_PID_FILE" "$FRONTEND_PORT"; then
    warn "Frontend already running on port $FRONTEND_PORT"
  else
    if [[ "$MODE" == "prod" ]]; then
      # Production mode: build once, then serve the built app. Several times
      # faster on this laptop than `next dev`, which compiles pages on the fly
      # and runs React's slow development checks. Rebuild after code changes
      # (./app.sh stop && ./app.sh start --prod).
      info "Building the frontend (production) … this takes a few minutes"
      (cd "$FRONTEND_DIR" && NODE_OPTIONS=--max-old-space-size=2048 npm run build) > "$FRONTEND_LOG" 2>&1 \
        || { warn "Build failed — see $FRONTEND_LOG"; return 1; }
      info "Starting frontend (production) on port $FRONTEND_PORT …"
      setsid bash -c "echo \$\$ > '$FRONTEND_PID_FILE'; cd '$FRONTEND_DIR' && exec npm run start" >> "$FRONTEND_LOG" 2>&1 < /dev/null &
    else
      info "Starting frontend (dev) on port $FRONTEND_PORT …"
      setsid bash -c "echo \$\$ > '$FRONTEND_PID_FILE'; cd '$FRONTEND_DIR' && exec npm run dev" > "$FRONTEND_LOG" 2>&1 < /dev/null &
    fi
    sleep 0.5
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
  kill_service "MCP server" "$MCP_PID_FILE" "$MCP_PORT"
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
  if running "$MCP_PID_FILE" "$MCP_PORT"; then
    echo -e "  MCP       (port $MCP_PORT)  ${GREEN}● running${NC}"
  else
    echo -e "  MCP       (port $MCP_PORT)  ${RED}○ stopped${NC}"
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

MODE=dev
[[ "${2:-}" == "--prod" ]] && MODE=prod

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
    echo "           add --prod for a built, much faster frontend (rebuild after code changes)"
    echo "  stop     Kill everything"
    echo "  status   Show what's running"
    echo "  logs     Tail live logs from backend + frontend"
    echo ""
    ;;
esac
