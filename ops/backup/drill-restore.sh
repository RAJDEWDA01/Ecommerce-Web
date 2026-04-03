#!/usr/bin/env bash
set -euo pipefail

if ! command -v mongorestore >/dev/null 2>&1; then
  echo "mongorestore not found. Install MongoDB Database Tools."
  exit 1
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: ./drill-restore.sh <mongo-uri> <archive-path> [source-database] [target-database]"
  exit 1
fi

MONGO_URI="$1"
ARCHIVE_PATH="$2"
SOURCE_DATABASE="${3:-}"
TARGET_DATABASE="${4:-}"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Archive not found: $ARCHIVE_PATH"
  exit 1
fi

if [[ -z "$SOURCE_DATABASE" ]]; then
  SOURCE_DATABASE="${MONGO_URI##*/}"
  SOURCE_DATABASE="${SOURCE_DATABASE%%\?*}"
fi

if [[ -z "$SOURCE_DATABASE" ]]; then
  echo "Unable to infer source database. Pass source-database explicitly."
  exit 1
fi

if [[ -z "$TARGET_DATABASE" ]]; then
  TARGET_DATABASE="${SOURCE_DATABASE}_restore_drill_$(date +%Y%m%d_%H%M%S)"
fi

echo "Running restore drill from '$SOURCE_DATABASE' to '$TARGET_DATABASE'"
mongorestore \
  --uri="$MONGO_URI" \
  --archive="$ARCHIVE_PATH" \
  --gzip \
  --nsFrom="$SOURCE_DATABASE.*" \
  --nsTo="$TARGET_DATABASE.*" \
  --drop

echo "Restore drill completed successfully."
echo "Target drill database: $TARGET_DATABASE"
