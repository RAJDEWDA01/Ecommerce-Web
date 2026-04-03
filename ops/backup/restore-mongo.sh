#!/usr/bin/env bash
set -euo pipefail

if ! command -v mongorestore >/dev/null 2>&1; then
  echo "mongorestore not found. Install MongoDB Database Tools."
  exit 1
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: ./restore-mongo.sh <mongo-uri> <archive-path> [--drop]"
  exit 1
fi

MONGO_URI="$1"
ARCHIVE_PATH="$2"
DROP_FLAG="${3:-}"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Archive not found: $ARCHIVE_PATH"
  exit 1
fi

RESTORE_ARGS=(--uri="$MONGO_URI" --archive="$ARCHIVE_PATH" --gzip)

if [[ "$DROP_FLAG" == "--drop" ]]; then
  RESTORE_ARGS+=(--drop)
fi

echo "Restoring archive: $ARCHIVE_PATH"
mongorestore "${RESTORE_ARGS[@]}"
echo "Restore completed successfully."
