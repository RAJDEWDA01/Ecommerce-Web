#!/usr/bin/env bash
set -euo pipefail

if ! command -v mongodump >/dev/null 2>&1; then
  echo "mongodump not found. Install MongoDB Database Tools."
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: ./backup-mongo.sh <mongo-uri> [output-directory]"
  exit 1
fi

MONGO_URI="$1"
OUTPUT_DIR="${2:-./artifacts/mongo-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$OUTPUT_DIR"
ARCHIVE_PATH="$OUTPUT_DIR/gaumaya-backup-$TIMESTAMP.archive.gz"
CHECKSUM_PATH="$ARCHIVE_PATH.sha256"

echo "Creating backup archive: $ARCHIVE_PATH"
mongodump --uri="$MONGO_URI" --archive="$ARCHIVE_PATH" --gzip
sha256sum "$ARCHIVE_PATH" > "$CHECKSUM_PATH"

echo "Backup completed."
echo "Archive : $ARCHIVE_PATH"
echo "SHA256  : $CHECKSUM_PATH"
