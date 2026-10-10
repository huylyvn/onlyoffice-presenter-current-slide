#!/usr/bin/env bash
# Launch the patched Presenter-View build (runnable tree) with CDP enabled.
#
#   ./launch.sh [deck.pptx] [port]
#
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DECK="${1:-$REPO/deck-12.pptx}"
PORT="${2:-9333}"

# ONLYOFFICE Desktop Editors is single-instance: close any running copy first,
# otherwise this launch is forwarded to it and exits.
if pgrep -x DesktopEditors >/dev/null 2>&1; then
  echo "another DesktopEditors instance is running (single-instance app)."
  echo "close it first, or run: pkill -x DesktopEditors"
  exit 1
fi

cd "$REPO"
APP_DIR="$REPO" DISPLAY="${DISPLAY:-:0}" \
  LD_LIBRARY_PATH="$REPO:$REPO/converter:$REPO/lib" \
  QT_QPA_PLATFORM_PLUGIN_PATH="$REPO/platforms" \
  QT_PLUGIN_PATH="$REPO" QT_QPA_PLATFORM=xcb \
  ./DesktopEditors --no-sandbox --remote-debugging-port="$PORT" "$DECK"
