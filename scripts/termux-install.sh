#!/data/data/com.termux/files/usr/bin/sh
# Automaton Termux Installer
#
# One-line install on Termux (Android):
#   curl -fsSL https://raw.githubusercontent.com/ropuk019/automaton-termux/main/scripts/termux-install.sh | sh
#
# Or, if you've cloned the repo already:
#   sh scripts/termux-install.sh
#
# This script is the Termux equivalent of the upstream Conway installer.
# It avoids pnpm/corepack and native C++ addons (better-sqlite3), using
# npm + tsc and a pure-JS SQLite shim (node:sqlite / sql.js) instead.
set -e

REPO="https://github.com/ropuk019/automaton-termux.git"

# ─── Install directory ─────────────────────────────────────────────
if [ -n "$AUTOMATON_DIR" ]; then
  INSTALL_DIR="$AUTOMATON_DIR"
else
  INSTALL_DIR="$HOME/.automaton/runtime"
fi

echo "[INFO]  Install target: $INSTALL_DIR"

# ─── Preflight: pkg / Termux ───────────────────────────────────────
if [ -d "/data/data/com.termux" ] || [ -n "$PREFIX" ] && echo "$PREFIX" | grep -q "com.termux"; then
  echo "[INFO]  Termux detected."
  if ! command -v node >/dev/null 2>&1; then
    echo "[INFO]  Installing Node.js via pkg..."
    pkg install -y nodejs git curl
  fi
  if ! command -v git >/dev/null 2>&1; then
    pkg install -y git
  fi
else
  echo "[WARN]  Not running inside Termux. This installer is tuned for Termux,"
  echo "        but will proceed on any Linux/macOS box with Node >= 20."
fi

# ─── Preflight: Node.js >= 20 ──────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is required (>= 20). Install it first." >&2
  echo "        Termux:  pkg install nodejs" >&2
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[ERROR] Node.js >= 20 required, found $(node -v)." >&2
  echo "        Termux:  pkg upgrade nodejs" >&2
  exit 1
fi
echo "[INFO]  Node.js: $(node -v)"

# Node 22.5+ ships a built-in SQLite (node:sqlite) — no native build needed.
# Node 20/21 will fall back to sql.js (pure WASM), installed by npm.
if [ "$NODE_MAJOR" -ge 22 ]; then
  echo "[INFO]  Node >= 22: using built-in node:sqlite (no native compilation)."
else
  echo "[INFO]  Node 20/21: will use sql.js (pure WASM SQLite) — no native compilation."
fi

# ─── Preflight: git ────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  echo "[ERROR] git is required." >&2
  exit 1
fi

# ─── Clone or update ───────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[INFO]  Updating existing installation at $INSTALL_DIR..."
  cd "$INSTALL_DIR" && git pull --ff-only
else
  echo "[INFO]  Cloning automaton-termux to $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ─── Install + build (npm, not pnpm — Termux-friendly) ─────────────
echo "[INFO]  Installing dependencies (npm)..."
npm install --no-audit --no-fund

echo "[INFO]  Building..."
npm run build

# ─── Launch ────────────────────────────────────────────────────────
echo "[INFO]  Build complete. Launching automaton..."
echo ""
echo "  Tip: set an inference provider before first run, e.g.:"
echo "    export OPENAI_API_KEY=sk-..."
echo "    # or, with a local Ollama server:"
echo "    export OLLAMA_BASE_URL=http://localhost:11434"
echo ""
exec node dist/index.js --run
