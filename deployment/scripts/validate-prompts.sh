#!/usr/bin/env bash
# validate-prompts.sh
# Computes SHA-256 checksums for all prompt files and verifies them
# against the checksums.json manifest.
# Exits 0 if all checksums match. Exits 1 if any mismatch.
#
# Usage:
#   bash deployment/scripts/validate-prompts.sh
#
# Source: Implementation Spec V1 Section 14.

set -euo pipefail

PROMPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/prompts"
CHECKSUMS_FILE="${PROMPTS_DIR}/checksums.json"

if [ ! -f "${CHECKSUMS_FILE}" ]; then
  echo "ERROR: checksums.json not found at ${CHECKSUMS_FILE}"
  exit 1
fi

FAILED=0
VERIFIED=0

echo "Validating prompt checksums..."
echo "Prompts directory: ${PROMPTS_DIR}"
echo ""

# Read each entry from checksums.json
# Requires: jq (install via brew install jq or apt-get install jq)
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required but not installed."
  echo "Install with: brew install jq  (macOS) or  apt-get install jq  (Linux)"
  exit 1
fi

while IFS= read -r prompt_id; do
  expected=$(jq -r --arg id "${prompt_id}" '.[$id]' "${CHECKSUMS_FILE}")
  file="${PROMPTS_DIR}/${prompt_id}.txt"

  if [ ! -f "${file}" ]; then
    echo "MISSING: ${prompt_id}.txt"
    FAILED=$((FAILED + 1))
    continue
  fi

  # Compute SHA-256 (cross-platform: sha256sum on Linux, shasum on macOS)
  if command -v sha256sum &> /dev/null; then
    actual=$(sha256sum "${file}" | awk '{print $1}')
  elif command -v shasum &> /dev/null; then
    actual=$(shasum -a 256 "${file}" | awk '{print $1}')
  else
    echo "ERROR: Neither sha256sum nor shasum is available."
    exit 1
  fi

  if [ "${actual}" = "${expected}" ]; then
    echo "OK:      ${prompt_id}.txt  (${actual:0:16}...)"
    VERIFIED=$((VERIFIED + 1))
  else
    echo "FAIL:    ${prompt_id}.txt"
    echo "         expected: ${expected}"
    echo "         actual:   ${actual}"
    FAILED=$((FAILED + 1))
  fi

done < <(jq -r 'keys[]' "${CHECKSUMS_FILE}")

echo ""
echo "Results: ${VERIFIED} verified, ${FAILED} failed"

if [ "${FAILED}" -gt 0 ]; then
  echo "CHECKSUM VALIDATION FAILED"
  exit 1
fi

echo "All prompt checksums verified successfully."
exit 0
