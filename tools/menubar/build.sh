#!/bin/zsh
# Builds tools/menubar into .bin/OteMenuBar.app (ad-hoc signed). Install: copy it to /Applications.
set -euo pipefail
cd "$(dirname "$0")"
APP=../../.bin/OteMenuBar.app
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
# universal: Apple Silicon and Intel Macs
TMP=$(mktemp -d)
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target $arch-apple-macos13.0 main.swift -o "$TMP/OteMenuBar-$arch" -framework AppKit -framework ServiceManagement
done
lipo -create "$TMP/OteMenuBar-arm64" "$TMP/OteMenuBar-x86_64" -output "$APP/Contents/MacOS/OteMenuBar"
rm -rf "$TMP"
codesign --force -s - --identifier io.github.ote.menubar "$APP"
echo "built $APP"
