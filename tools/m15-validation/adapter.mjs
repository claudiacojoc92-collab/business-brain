/**
 * Labeled-content adapter. Takes real content per source (a JSON array) and normalises it
 * into one input set for the engine. Manual/pasted content only — no fetching, no scraping.
 *
 * Input file shape (JSON):
 *   [
 *     { "source": "website",   "content": "…real text pasted/exported from the site…" },
 *     { "source": "instagram", "content": "…real captions/posts…" },
 *     { "source": "linkedin",  "content": "…real posts/about…" }
 *   ]
 */
import { readFileSync } from 'node:fs';

export function loadInputSet(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read/parse input JSON at ${filePath}: ${e.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Input must be a non-empty JSON array of { source, content } objects.');
  }

  const pieces = [];
  parsed.forEach((row, i) => {
    const source = typeof row?.source === 'string' ? row.source.trim() : '';
    const content = typeof row?.content === 'string' ? row.content.trim() : '';
    if (!source) throw new Error(`Row ${i}: missing/empty "source".`);
    if (!content) throw new Error(`Row ${i} (${source}): missing/empty "content".`);
    pieces.push({ source, content });
  });

  const sourceNames = [...new Set(pieces.map((p) => p.source))];
  return { pieces, sourceNames };
}
