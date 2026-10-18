#!/bin/bash
# Double-click to install or update Sync (macOS; on Linux run: bash "Install Sync.command").
cd "$(dirname "$0")"
bash scripts/install/bootstrap.sh "$@"
status=$?
echo
read -r -p "Press Enter to close this window." _
exit $status
