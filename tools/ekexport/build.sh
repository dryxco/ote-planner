#!/bin/zsh
# Builds tools/ekexport into .bin/SyncCalendar.app (ad-hoc signed so macOS remembers the permission).
set -euo pipefail
cd "$(dirname "$0")"
APP=../../.bin/SyncCalendar.app
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
swiftc -O main.swift -o "$APP/Contents/MacOS/SyncCalendar" -framework EventKit
codesign --force -s - --identifier io.github.sync.calendar "$APP"
echo "built $APP"
