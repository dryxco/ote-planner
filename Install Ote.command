#!/bin/bash
# Double-click to install or update Ote (macOS; on Linux run: bash "Install Ote.command").
cd "$(dirname "$0")"
bash scripts/install/bootstrap.sh "$@"
status=$?
echo
read -r -p "Press Enter to close this window." _
exit $status
