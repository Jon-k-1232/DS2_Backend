#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC_DIR="$ROOT_DIR/modules"

if [ ! -d "$SRC_DIR" ]; then
  echo "Source modules directory not found: $SRC_DIR" >&2
  exit 1
fi

for env in dev prod; do
  DEST_DIR="$ROOT_DIR/envs/$env/modules"
  rm -rf "$DEST_DIR"
  mkdir -p "$DEST_DIR"
  rsync -a "$SRC_DIR/" "$DEST_DIR/"
  echo "Synced modules to $DEST_DIR"

done
