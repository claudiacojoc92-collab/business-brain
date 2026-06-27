#!/usr/bin/env bash
# rollback.sh — Rolls back the most recent Flyway migration.
# Usage: bash deployment/scripts/rollback.sh [target_version]
# WARNING: Flyway Community does not support undo migrations.
# This script drops the schema and re-runs migrations to the target version.
# USE WITH EXTREME CAUTION IN PRODUCTION.

set -euo pipefail

TARGET_VERSION="${1:-}"

if [ -z "${TARGET_VERSION}" ]; then
  echo "Usage: bash deployment/scripts/rollback.sh <target_version>"
  echo "Example: bash deployment/scripts/rollback.sh 45"
  echo ""
  echo "WARNING: This drops and recreates the schema to the target version."
  echo "All data will be lost. Only use in development."
  exit 1
fi

echo "WARNING: Rolling back to V${TARGET_VERSION}"
echo "All data will be lost. Press Ctrl+C within 5 seconds to cancel."
sleep 5

DATABASE_URL="${DATABASE_URL:-postgresql://bbuser:bbpassword@localhost:5432/businessbrain}"

echo "Dropping schemas..."
psql "${DATABASE_URL}" -c "
DROP SCHEMA IF EXISTS founder  CASCADE;
DROP SCHEMA IF EXISTS cycle    CASCADE;
DROP SCHEMA IF EXISTS memory   CASCADE;
DROP SCHEMA IF EXISTS campaign CASCADE;
DROP SCHEMA IF EXISTS outcome  CASCADE;
DROP SCHEMA IF EXISTS app      CASCADE;
DROP SCHEMA IF EXISTS audit    CASCADE;
DROP SCHEMA IF EXISTS bb_types CASCADE;
"

echo "Re-running migrations to V${TARGET_VERSION}..."
docker compose run --rm migrate \
  -target="${TARGET_VERSION}"

echo "Rollback to V${TARGET_VERSION} complete."
