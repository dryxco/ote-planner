#!/bin/bash
# Double-click to remove Sync (your data stays; add --purge to delete it too).
cd "$(dirname "$0")"
bash scripts/install/bootstrap.sh --uninstall "$@"
echo
read -r -p "Press Enter to close this window." _
