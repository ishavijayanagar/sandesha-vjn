#!/usr/bin/env bash
# Sandesha — start the WhatsApp bot (cleans stale lock / Chrome before launch)
#
# Usage:
#   ./start.sh          Start bot (reuse saved WhatsApp session if present)
#   ./start.sh --reset  Clear session and force new QR scan
#   ./start.sh --help

set -euo pipefail

cd "$(dirname "$0")"
SESSION_DIR="$(pwd)/.wwebjs_auth/session"
LOCK_FILE="$(pwd)/.lock"
LISTEN_PORT=42620

usage() {
  cat <<'EOF'
Sandesha start script

  ./start.sh          Start the bot (default)
  ./start.sh --reset  Delete WhatsApp session and scan QR again
  ./start.sh --help   Show this help

Only one instance can run at a time.
EOF
}

stop_existing() {
  echo "[1/3] Stopping any existing Sandesha processes..."

  if pgrep -f "node listen.js" >/dev/null 2>&1; then
    pkill -f "node listen.js" 2>/dev/null || true
    sleep 1
    if pgrep -f "node listen.js" >/dev/null 2>&1; then
      pkill -9 -f "node listen.js" 2>/dev/null || true
      sleep 1
    fi
  fi

  if pgrep -f "user-data-dir=${SESSION_DIR}" >/dev/null 2>&1; then
    pkill -f "user-data-dir=${SESSION_DIR}" 2>/dev/null || true
    sleep 1
    if pgrep -f "user-data-dir=${SESSION_DIR}" >/dev/null 2>&1; then
      pkill -9 -f "user-data-dir=${SESSION_DIR}" 2>/dev/null || true
      sleep 1
    fi
  fi

  rm -f "$LOCK_FILE"

  # Free API port if a zombie process is still holding it
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${LISTEN_PORT}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti ":${LISTEN_PORT}" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  fi
  sleep 1
}

reset_session() {
  echo "[2/3] Clearing WhatsApp session..."
  rm -rf "$(pwd)/.wwebjs_auth"
  rm -f "$(pwd)/qr-code.png"
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Error: node not found. Install Node.js 18+ and try again."
    exit 1
  fi
}

main() {
  local reset=false

  for arg in "$@"; do
    case "$arg" in
      --reset|-r) reset=true ;;
      --help|-h) usage; exit 0 ;;
      *)
        echo "Unknown option: $arg"
        usage
        exit 1
        ;;
    esac
  done

  echo "========================================"
  echo " Sandesha Bot — Starting"
  echo "========================================"
  echo

  check_node
  stop_existing

  if $reset; then
    reset_session
  else
    echo "[2/3] Keeping saved WhatsApp session (use --reset to re-scan QR)"
  fi

  if [[ ! -d node_modules ]]; then
    echo "Installing dependencies..."
    npm install
  fi

  echo "[3/3] Starting listen.js..."
  echo "      QR code will appear below and in qr-code.png"
  echo "      Press Ctrl+C to stop"
  echo

  node listen.js
}

main "$@"
