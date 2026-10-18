#!/bin/zsh
# Builds tools/menubar into .bin/SyncMenuBar.app (ad-hoc signed). Install: copy it to /Applications.
set -euo pipefail
cd "$(dirname "$0")"
APP=../../.bin/SyncMenuBar.app
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
# universal: Apple Silicon and Intel Macs
TMP=$(mktemp -d)
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target $arch-apple-macos13.0 main.swift -o "$TMP/SyncMenuBar-$arch" -framework AppKit -framework ServiceManagement
done
lipo -create "$TMP/SyncMenuBar-arm64" "$TMP/SyncMenuBar-x86_64" -output "$APP/Contents/MacOS/SyncMenuBar"
rm -rf "$TMP"
codesign --force -s - --identifier io.github.sync.menubar "$APP"
echo "built $APP"
