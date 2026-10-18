#!/bin/bash
# macOS / Linux: makes sure a Node.js 20.9+ is there (downloads the official one into Ote's folder
# if not, checked against nodejs.org's published checksums), then runs scripts/install.mjs.
set -euo pipefail
cd "$(dirname "$0")/../.."

case "$(uname -s)" in
  Darwin) OS=darwin; BASE=${OTE_INSTALL_BASE:-"$HOME/Library/Application Support/Ote"} ;;
  Linux) OS=linux; BASE=${OTE_INSTALL_BASE:-"${XDG_DATA_HOME:-$HOME/.local/share}/ote"} ;;
  *) echo "This installer is for macOS and Linux. On Windows, double-click \"Install Ote.cmd\"."; exit 1 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) ARCH=arm64 ;;
  x86_64 | amd64) ARCH=x64 ;;
  *) echo "Unsupported processor: $(uname -m)"; exit 1 ;;
esac

new_enough() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)' 2>/dev/null; }

NODE=""
if [[ -x "$BASE/runtime/bin/node" ]] && new_enough "$BASE/runtime/bin/node"; then
  NODE="$BASE/runtime/bin/node"
elif command -v node >/dev/null && new_enough "$(command -v node)"; then
  NODE="$(command -v node)"
else
  echo "› Getting Node.js (the engine Ote runs on)"
  DIST=https://nodejs.org/dist/latest-v24.x
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$DIST/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  LINE=$(grep -E " node-v[0-9.]+-$OS-$ARCH\.tar\.gz$" "$TMP/SHASUMS256.txt" | head -1)
  [[ -n "$LINE" ]] || { echo "No Node.js download for $OS-$ARCH"; exit 1; }
  FILE=${LINE##* }
  curl -fSL --progress-bar "$DIST/$FILE" -o "$TMP/$FILE"
  if command -v shasum >/dev/null; then GOT=$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1); else GOT=$(sha256sum "$TMP/$FILE" | cut -d' ' -f1); fi
  [[ "$GOT" == "${LINE%% *}" ]] || { echo "The Node.js download is damaged (checksum mismatch). Try again."; exit 1; }
  rm -rf "$BASE/runtime"
  mkdir -p "$BASE/runtime"
  tar -xzf "$TMP/$FILE" -C "$BASE/runtime" --strip-components=1
  NODE="$BASE/runtime/bin/node"
fi
export PATH="$(dirname "$NODE"):$PATH"
exec "$NODE" scripts/install.mjs "$@"
