/**
 * PEOPLE-FIDELITY GUARD — a hard, deterministic check that the generator did not CORRUPT a licensed person's
 * name. Two real model failures motivate it, neither fixable by prompting: normalizing a rarer surname to a
 * common one ("Laza" → "Lazăr"), and binding the wrong adjacent name inside an enumeration ("Carmen
 * Constantinescu" → "Carmen Mureșan", borrowed from the next list item). This is the deterministic kernel
 * earning its keep again.
 *
 * THE BOUNDARY IS DIACRITIC FOLDING. Fold case + diacritics on both sides:
 *   - folded forms match  → ALLOWED — orthographic restoration of the same word ("Borsan" → "Borșan").
 *   - folded forms differ → CORRUPTION — a different word ("laza" ≠ "lazar"), blocked.
 * Scoped to `people` ONLY: Romanian inflects, so a blanket verbatim-in-output rule would wreck prose
 * ("Kinetoterapie" → "kinetoterapia noastră" is grammar, not corruption). Personal names don't inflect that
 * way and getting one wrong is the concrete harm — so the hard guard lives here and nowhere else.
 */
export interface PeopleFidelityFinding {
  readonly expected: string;          // the licensed name (first + last), as written
  readonly foundVariant: string | null; // what the draft wrote near the first name instead, or null if absent
}

/** Fold diacritics + case; split into whole tokens (hyphens kept inside a token: "Nagy-Demo", "Oana-Andreea"). */
function foldTokens(s: string): string[] {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
}

/**
 * Returns a finding per licensed person whose name is NOT correctly present in the draft. A name is present
 * when its first and last tokens appear as whole, diacritic-folded tokens ADJACENT to each other (either order,
 * so surname-first passes; diacritic restoration passes). Adjacency — not a wider window — is deliberate: in a
 * dense staff list a 2–3 token window lets a first name pair with a DIFFERENT person's nearby surname, so a
 * swap ("Bogdan Laza … Florin Borsan") would slip through. A real name is written as one adjacent unit; a
 * normalized surname ("Lazăr") or a borrowed one ("Carmen Mureșan") breaks the adjacency. Empty ⇒ all faithful.
 */
export function checkPeopleFidelity(draftText: string, peopleValues: readonly string[], mode: 'all' | 'named' = 'all'): PeopleFidelityFinding[] {
  const dt = foldTokens(draftText);
  const findings: PeopleFidelityFinding[] = [];
  for (const value of peopleValues) {
    const folded = foldTokens(value).slice(0, 2);     // first + last
    const original = value.split(/\s+/).slice(0, folded.length).join(' ');
    if (folded.length === 0) continue;
    // 'named' (a FOCUSED team section): a person the page leaves out is fine; one it mentions must be exact. A
    // person counts as mentioned when their first-name token appears, so a corrupted or borrowed surname is still caught.
    if (mode === 'named' && !dt.includes(folded[0] as string)) continue;
    if (folded.length === 1) {                        // single-token name
      if (!dt.includes(folded[0] as string)) findings.push({ expected: original, foundVariant: null });
      continue;
    }
    const [first, last] = folded as [string, string];
    const firstAt = dt.flatMap((t, i) => (t === first ? [i] : []));
    const lastAt = dt.flatMap((t, i) => (t === last ? [i] : []));
    const present = firstAt.some((i) => lastAt.some((j) => Math.abs(i - j) === 1)); // adjacent, either order
    if (!present) {
      const idx = dt.indexOf(first);
      const variant = idx !== -1 && dt[idx + 1] ? `${first} ${dt[idx + 1]}` : null; // the corrupted surname, if any
      findings.push({ expected: original, foundVariant: variant });
    }
  }
  return findings;
}

/** How many licensed people the draft names correctly (first + last adjacent, diacritic-folded). */
export function countNamedPeople(draftText: string, peopleValues: readonly string[]): number {
  return peopleValues.filter((v) => checkPeopleFidelity(draftText, [v]).length === 0).length;
}
