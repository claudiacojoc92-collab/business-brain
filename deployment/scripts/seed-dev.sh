#!/usr/bin/env bash
# seed-dev.sh — Seeds development data into the local database.
# Usage: bash deployment/scripts/seed-dev.sh
# Reads DATABASE_URL from environment (defaults to local dev URL).

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://bbuser:bbpassword@localhost:5432/businessbrain}"

echo "Seeding dev data..."
echo "Target: ${DATABASE_URL%%@*}@..."

psql "${DATABASE_URL}" -f database/seeds/dev-founder.seed.sql
psql "${DATABASE_URL}" -f database/seeds/prompt-registry.seed.sql

echo "Dev seed complete."
echo ""
echo "Dev founder created:"
echo "  ID:    01HDEV000000000000000FOUNDER"
echo "  Email: dev@businessbrain.ai"
echo "  Status: ACTIVE"
