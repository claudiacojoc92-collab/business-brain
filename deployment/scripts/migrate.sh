#!/usr/bin/env bash
# migrate.sh — Applies Flyway migrations against the target database.
# Usage: bash deployment/scripts/migrate.sh
# Reads DATABASE_URL from environment.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

echo "Running Flyway migrations..."
echo "Target: ${DATABASE_URL%%@*}@..."

docker compose run --rm migrate

echo "Migrations complete."
