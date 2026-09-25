#!/bin/sh
# Copy the versioned documentation into the DS2 Obsidian vault (DS2/DS2_Notes).
#   DS2_Backend/docs/                              -> <vault>/Documentation/   (mirrored; edit the repo copy, not this one)
#   DS2_Backend/scripts/review-2026-09/FINAL_REPORT.md -> <vault>/Reports/Full Review 2026-09.md
#   DS2/MEMORY.md (change log)                     -> <vault>/Change Log.md
# Usage: sh scripts/docs/sync-notes.sh [path/to/vault]   (default: ../DS2_Notes next to DS2_Backend)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
BACKEND=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$BACKEND/.." && pwd)
VAULT=${1:-"$ROOT/DS2_Notes"}
[ -d "$VAULT/.obsidian" ] || { echo "Refusing: $VAULT is not an Obsidian vault (no .obsidian folder)." >&2; exit 1; }
[ -d "$BACKEND/docs" ] || { echo "No docs folder at $BACKEND/docs" >&2; exit 1; }
mkdir -p "$VAULT/Documentation" "$VAULT/Reports"
rsync -a --delete --exclude '.DS_Store' "$BACKEND/docs/" "$VAULT/Documentation/"
cp "$BACKEND/scripts/review-2026-09/FINAL_REPORT.md" "$VAULT/Reports/Full Review 2026-09.md"
[ -f "$ROOT/MEMORY.md" ] && cp "$ROOT/MEMORY.md" "$VAULT/Change Log.md"
echo "Synced $(find "$VAULT/Documentation" -name '*.md' | wc -l | tr -d ' ') documentation notes into $VAULT"
