#!/usr/bin/env bash
# llama.sh — manage the local llama.cpp stack for Second Brain
# Usage:
#   ./llama.sh setup   — clone, build, download models (run once)
#   ./llama.sh start   — start generation + embedding servers in background
#   ./llama.sh stop    — kill both servers
#   ./llama.sh status  — show whether servers are running
#   ./llama.sh logs    — tail live logs from both servers

set -euo pipefail

LLAMA_DIR="$HOME/llama.cpp"
MODELS_DIR="$LLAMA_DIR/models"
GEN_PORT=8080
EMBED_PORT=8081
GEN_LOG="/tmp/llama-gen.log"
EMBED_LOG="/tmp/llama-embed.log"
GEN_PID_FILE="/tmp/llama-gen.pid"
EMBED_PID_FILE="/tmp/llama-embed.pid"

GEN_MODEL="google_gemma-4-E2B-it-IQ2_M.gguf"
EMBED_MODEL="nomic-embed-text-v1.5.f16.gguf"
GEN_URL="https://huggingface.co/bartowski/google_gemma-4-e2b-it-GGUF/resolve/main/$GEN_MODEL"
EMBED_URL="https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/$EMBED_MODEL"

# ── colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
info() { echo -e "${BLUE}→${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
die()  { echo -e "${RED}✗${NC} $*"; exit 1; }

# ── helpers ───────────────────────────────────────────────────────────────────
server_running() {
  local pid_file=$1 port=$2
  if [[ -f "$pid_file" ]]; then
    local pid; pid=$(cat "$pid_file")
    kill -0 "$pid" 2>/dev/null && return 0
  fi
  # fallback: check port
  lsof -ti ":$port" &>/dev/null && return 0
  return 1
}

kill_server() {
  local name=$1 pid_file=$2 port=$3
  if [[ -f "$pid_file" ]]; then
    local pid; pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && ok "Stopped $name (pid $pid)"
    fi
    rm -f "$pid_file"
  fi
  # also kill anything on the port
  local leftover; leftover=$(lsof -ti ":$port" 2>/dev/null || true)
  if [[ -n "$leftover" ]]; then
    kill $leftover 2>/dev/null || true
    ok "Cleaned up port $port"
  fi
}

download_model() {
  local url=$1 dest=$2 name=$3
  if [[ -f "$dest" && $(stat -c%s "$dest") -gt 1048576 ]]; then
    ok "$name already downloaded ($(du -sh "$dest" | cut -f1)) — skipping"
    return
  fi
  # remove incomplete/empty file if present
  [[ -f "$dest" ]] && rm -f "$dest"
  info "Downloading $name …"
  if command -v wget &>/dev/null; then
    wget --show-progress -O "$dest" "$url" || { rm -f "$dest"; die "Download failed for $name"; }
  elif command -v curl &>/dev/null; then
    curl -L --progress-bar -o "$dest" "$url" || { rm -f "$dest"; die "Download failed for $name"; }
  else
    die "Neither wget nor curl found — install one and retry"
  fi
  ok "$name downloaded ($(du -sh "$dest" | cut -f1))"
}

# ── commands ──────────────────────────────────────────────────────────────────

cmd_setup() {
  echo ""
  echo -e "${BLUE}═══ Second Brain — llama.cpp Setup ═══${NC}"
  echo ""

  # 1. clone
  if [[ -d "$LLAMA_DIR/.git" ]]; then
    ok "llama.cpp repo already cloned"
  else
    info "Cloning llama.cpp …"
    git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_DIR"
    ok "Cloned to $LLAMA_DIR"
  fi

  # 2. build
  local binary="$LLAMA_DIR/build/bin/llama-server"
  if [[ -f "$binary" ]]; then
    ok "llama-server binary already built"
  else
    info "Building llama.cpp (this takes 2–5 min) …"
    cmake -B "$LLAMA_DIR/build" -S "$LLAMA_DIR" -DLLAMA_CURL=ON -DCMAKE_BUILD_TYPE=Release -Wno-dev 2>&1 | grep -v "^--"
    cmake --build "$LLAMA_DIR/build" --config Release -j"$(nproc)" 2>&1 | tail -5
    [[ -f "$binary" ]] || die "Build failed — binary not found at $binary"
    ok "Built successfully"
  fi

  # 3. models
  mkdir -p "$MODELS_DIR"
  download_model "$GEN_URL"   "$MODELS_DIR/$GEN_MODEL"   "Gemma 4 E2B (generation, ~1.2 GB)"
  download_model "$EMBED_URL" "$MODELS_DIR/$EMBED_MODEL" "nomic-embed-text (embeddings, ~270 MB)"

  echo ""
  ok "Setup complete! Run: ${YELLOW}./llama.sh start${NC}"
  echo ""
}

cmd_start() {
  local binary="$LLAMA_DIR/build/bin/llama-server"
  [[ -f "$binary" ]] || die "llama.cpp not built yet — run: ./llama.sh setup"
  [[ -f "$MODELS_DIR/$GEN_MODEL" ]]   || die "Generation model missing — run: ./llama.sh setup"
  [[ -f "$MODELS_DIR/$EMBED_MODEL" ]] || die "Embedding model missing — run: ./llama.sh setup"

  echo ""

  # generation server
  if server_running "$GEN_PID_FILE" "$GEN_PORT"; then
    warn "Generation server already running on port $GEN_PORT"
  else
    info "Starting generation server (Gemma 4 E2B) on port $GEN_PORT …"
    "$binary" \
      -m "$MODELS_DIR/$GEN_MODEL" \
      --port "$GEN_PORT" \
      --ctx-size 8192 \
      --n-predict 2048 \
      -ngl 0 \
      --cache-type-k q8_0 \
      --cache-type-v q8_0 \
      > "$GEN_LOG" 2>&1 &
    echo $! > "$GEN_PID_FILE"
    ok "Generation server started (pid $(cat $GEN_PID_FILE)) — logs: $GEN_LOG"
  fi

  # embedding server
  if server_running "$EMBED_PID_FILE" "$EMBED_PORT"; then
    warn "Embedding server already running on port $EMBED_PORT"
  else
    info "Starting embedding server (nomic-embed-text) on port $EMBED_PORT …"
    "$binary" \
      -m "$MODELS_DIR/$EMBED_MODEL" \
      --port "$EMBED_PORT" \
      --embedding \
      --ctx-size 2048 \
      --batch-size 2048 \
      -ngl 0 \
      > "$EMBED_LOG" 2>&1 &
    echo $! > "$EMBED_PID_FILE"
    ok "Embedding server started (pid $(cat $EMBED_PID_FILE)) — logs: $EMBED_LOG"
  fi

  echo ""
  info "Waiting for servers to become ready …"
  local ready=0
  for i in $(seq 1 30); do
    local g=0 e=0
    curl -sf "http://localhost:$GEN_PORT/health"   &>/dev/null && g=1
    curl -sf "http://localhost:$EMBED_PORT/health" &>/dev/null && e=1
    if [[ $g -eq 1 && $e -eq 1 ]]; then ready=1; break; fi
    printf "  [%2ds] gen=%s  embed=%s\r" "$((i*2))" "$([[ $g -eq 1 ]] && echo up || echo ...)" "$([[ $e -eq 1 ]] && echo up || echo ...)"
    sleep 2
  done
  echo ""

  if [[ $ready -eq 1 ]]; then
    echo ""
    ok "Both servers ready!"
    echo -e "  ${GREEN}Generation${NC}  → http://localhost:$GEN_PORT"
    echo -e "  ${GREEN}Embeddings${NC}  → http://localhost:$EMBED_PORT"
    echo ""
    echo -e "  Set in ${YELLOW}backend/.env${NC}:"
    echo -e "    LLM_PROVIDER=llamacpp"
    echo -e "    EMBEDDER_PROVIDER=llamacpp"
    echo ""
  else
    warn "Servers may still be loading (first load is slow — model is being mmap'd)."
    echo "  Check logs: ./llama.sh logs"
  fi
}

cmd_stop() {
  echo ""
  kill_server "generation server" "$GEN_PID_FILE" "$GEN_PORT"
  kill_server "embedding server"  "$EMBED_PID_FILE" "$EMBED_PORT"
  echo ""
  ok "All servers stopped"
  echo ""
}

cmd_status() {
  echo ""
  echo -e "${BLUE}═══ llama.cpp Server Status ═══${NC}"
  echo ""

  if server_running "$GEN_PID_FILE" "$GEN_PORT"; then
    local pid; pid=$(cat "$GEN_PID_FILE" 2>/dev/null || lsof -ti ":$GEN_PORT")
    echo -e "  Generation  (port $GEN_PORT)  ${GREEN}● running${NC}  pid=$pid"
  else
    echo -e "  Generation  (port $GEN_PORT)  ${RED}○ stopped${NC}"
  fi

  if server_running "$EMBED_PID_FILE" "$EMBED_PORT"; then
    local pid; pid=$(cat "$EMBED_PID_FILE" 2>/dev/null || lsof -ti ":$EMBED_PORT")
    echo -e "  Embeddings  (port $EMBED_PORT)  ${GREEN}● running${NC}  pid=$pid"
  else
    echo -e "  Embeddings  (port $EMBED_PORT)  ${RED}○ stopped${NC}"
  fi

  echo ""
  local gen_model="${MODELS_DIR}/${GEN_MODEL}"
  local emb_model="${MODELS_DIR}/${EMBED_MODEL}"
  echo -e "  Models in $MODELS_DIR:"
  [[ -f "$gen_model" ]]   && echo -e "    ${GREEN}✓${NC} $GEN_MODEL   ($(du -sh "$gen_model" | cut -f1))" \
                          || echo -e "    ${RED}✗${NC} $GEN_MODEL   (not downloaded)"
  [[ -f "$emb_model" ]]   && echo -e "    ${GREEN}✓${NC} $EMBED_MODEL ($(du -sh "$emb_model" | cut -f1))" \
                          || echo -e "    ${RED}✗${NC} $EMBED_MODEL (not downloaded)"
  echo ""
}

cmd_logs() {
  echo -e "${BLUE}→ Tailing both server logs (Ctrl+C to stop)${NC}"
  echo ""
  tail -f "$GEN_LOG" "$EMBED_LOG" 2>/dev/null || warn "No log files yet — start servers first"
}

# ── entrypoint ────────────────────────────────────────────────────────────────
case "${1:-help}" in
  setup)  cmd_setup  ;;
  start)  cmd_start  ;;
  stop)   cmd_stop   ;;
  status) cmd_status ;;
  logs)   cmd_logs   ;;
  *)
    echo ""
    echo -e "${BLUE}Usage:${NC} ./llama.sh <command>"
    echo ""
    echo "  setup    Clone, build llama.cpp and download both models"
    echo "  start    Start generation (port 8080) + embedding (port 8081) servers"
    echo "  stop     Kill both servers"
    echo "  status   Show server status and downloaded models"
    echo "  logs     Tail live logs from both servers"
    echo ""
    ;;
esac
