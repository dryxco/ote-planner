#!/bin/zsh
# Builds tools/ekexport into .bin/OteCalendar.app (ad-hoc signed so macOS remembers the permission).
set -euo pipefail
cd "$(dirname "$0")"
APP=../../.bin/OteCalendar.app
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
swiftc -O main.swift -o "$APP/Contents/MacOS/OteCalendar" -framework EventKit
codesign --force -s - --identifier io.github.ote.calendar "$APP"
echo "built $APP"
