import { generateId } from '@bb/shared';
import type { IBusinessEvidenceLinkRepository } from '../bi/contracts';
import type { IProofFragmentSource } from '../proof/contracts';
import { toSourceUnits } from '../bi/source-units';
import { ATOM_CLASSES, type AtomClass, type BusinessAtom, type IAtomExtractionModel, type IAtomRepository } from './contracts';

/** Deterministic staleness key over the bound-fragment set (same scheme as proof): re-extract only on change. */
function fingerprint(ids: string[]): string {
  let h = 0x811c9dc5;
  for (const id of [...ids].sort()) { for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); } }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + ids.length;
}

// ── Verbatim anchoring (the ONLY safety mechanism; language-neutral) ──────────────────────────────────────
// Matching is diacritic-FOLDED (Unicode NFD + strip combining marks) and WHITESPACE-INSENSITIVE (runs → one
// space), used ONLY to LOCATE the span. The licensed value is the EXACT original substring found — diacritics
// and line breaks preserved as written — so `unit.text.slice(charStart, charEnd) === value` holds by
// construction. No regex, no language gate, no reported-speech template.
function normalizeNeedle(raw: string): string {
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
/** Fold `raw` char-by-char, recording the original start/end index of each folded char (whitespace runs → one space). */
function buildFolded(raw: string): { f: string; starts: number[]; ends: number[] } {
  const chars: string[] = []; const starts: number[] = []; const ends: number[] = [];
  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i] as string)) {
      let j = i; while (j < raw.length && /\s/.test(raw[j] as string)) j++;
      chars.push(' '); starts.push(i); ends.push(j); i = j;
    } else {
      const folded = (raw[i] as string).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      for (const c of folded) { chars.push(c); starts.push(i); ends.push(i + 1); }
      i++;
    }
  }
  return { f: chars.join(''), starts, ends };
}
/**
 * The verbatim span of `needle` in `raw`, or null. Never fuzzy. Two tiers:
 *   1. EXACT — case + diacritics + spacing identical. First exact occurrence wins, so a title-case service
 *      label ("Kinetoterapie") is preferred over an earlier lowercase prose mention, and the stored value
 *      equals the model's proposed casing — verbatim-equals-source stays literally true.
 *   2. FOLDED — whitespace-insensitive + diacritic-folded, for when the proposal differs in case/diacritics
 *      (e.g. "Postnatală" vs the page's "Postnatala") or spans lines; the span found is stored AS WRITTEN.
 */
function locate(raw: string, needle: string): { start: number; end: number } | null {
  const trimmed = needle.trim();
  if (trimmed) { const ex = raw.indexOf(trimmed); if (ex !== -1) return { start: ex, end: ex + trimmed.length }; }
  const N = normalizeNeedle(needle);
  if (!N) return null;
  const { f, starts, ends } = buildFolded(raw);
  const idx = f.indexOf(N);
  if (idx === -1) return null;
  return { start: starts[idx] as number, end: ends[idx + N.length - 1] as number };
}

/** Normalize a sourceRef for LENIENT resolution: fold case + diacritics, strip a trailing parenthetical. */
function normRef(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export interface AtomExtractionDeps {
  readonly links: IBusinessEvidenceLinkRepository;
  readonly evidence: IProofFragmentSource;
  readonly model: IAtomExtractionModel;
  readonly repo: IAtomRepository;
  readonly modelId?: string;
  readonly clock?: () => string;
  readonly log?: (e: { type: string; detail?: string }) => void;
}

/**
 * Licenses a business's verifiable operational atoms from its ingested fragments. The model PROPOSES; this
 * service LICENSES only what anchors verbatim, with a stored source pointer. A proposal that is not a verbatim
 * span is DROPPED — never repaired, trimmed or fuzzy-matched (a repaired anchor is a fabricated fact with a
 * pointer attached). Every extraction logs proposed-vs-licensed with a drop breakdown, so a prompt that
 * proposes mostly un-anchorable atoms is VISIBLE, not silently swallowed (that silent-discard is exactly how
 * a non-English business ended up with zero licensed facts).
 */
export class AtomExtractionService {
  constructor(private readonly deps: AtomExtractionDeps) {}

  private now(): string { return (this.deps.clock ?? (() => new Date().toISOString()))(); }

  /** Licensable business atoms with durable provenance (cached unless the bound source set changed). */
  async facts(businessId: string): Promise<BusinessAtom[]> {
    const ids = await this.deps.links.listFragmentIds(businessId);
    const fp = fingerprint(ids);
    if ((await this.deps.repo.latestFingerprint(businessId)) === fp) return this.deps.repo.listAtoms(businessId);
    if (ids.length === 0) { await this.deps.repo.replaceForBusiness(businessId, fp, []); return []; }

    const units = toSourceUnits(
      await this.deps.evidence.findByIds(ids),
      (e) => this.deps.log?.({ type: 'source_units_empty', detail: JSON.stringify(e) }), // loud: mapping break
    );
    if (units.length === 0) { await this.deps.repo.replaceForBusiness(businessId, fp, []); return []; }

    let proposals;
    try { proposals = (await this.deps.model.extract({ units })).atoms; }
    catch { this.deps.log?.({ type: 'atoms_extract_threw' }); return this.deps.repo.listAtoms(businessId); }

    // LENIENT RESOLUTION, never blind fallback: a cited ref resolves only if it maps to EXACTLY ONE unit
    // (normalized). Zero or ambiguous → DROP + count. Attestation must resolve; it is never replaced by a guess,
    // and dropped_unit stays the smoke alarm for a prompt that confabulates refs.
    const byNormRef = new Map<string, typeof units>();
    for (const u of units) { const k = normRef(u.sourceRef); const g = byNormRef.get(k); if (g) g.push(u); else byNormRef.set(k, [u]); }

    const atoms: BusinessAtom[] = [];
    const seen = new Set<string>();
    const now = this.now();
    let droppedClass = 0, droppedUnit = 0, droppedAnchor = 0, droppedDup = 0;

    for (const c of proposals) {
      if (!ATOM_CLASSES.includes(c.atomClass as AtomClass)) { droppedClass++; continue; } // closed scope
      const matches = byNormRef.get(normRef(c.sourceRef)) ?? [];
      if (matches.length !== 1) { droppedUnit++; continue; } // unresolved / ambiguous → drop (never guess the unit)
      const unit = matches[0] as (typeof units)[number];
      const span = locate(unit.text, c.value);
      if (!span) { droppedAnchor++; continue; }                 // NOT a verbatim span → DROP (never repair)
      const value = unit.text.slice(span.start, span.end);      // the EXACT original span — store as written
      const key = `${c.atomClass}\u0000${normalizeNeedle(value)}`;
      if (seen.has(key)) { droppedDup++; continue; }            // identical (class, value) → keep the first span
      seen.add(key);
      atoms.push({
        id: generateId(), businessId, atomClass: c.atomClass, value,
        sourceRef: unit.sourceRef, sourceUrl: unit.sourceUrl, charStart: span.start, charEnd: span.end,
        sourceFingerprint: fp, modelId: this.deps.modelId ?? null, extractedAt: now,
      });
    }

    // DROP-RATE SIGNAL — proposed vs licensed, with the breakdown. A low licensed/proposed ratio means the
    // prompt is wrong; it must be observable, never swallowed.
    this.deps.log?.({
      type: 'atoms_extracted',
      detail: `proposed=${proposals.length} licensed=${atoms.length} dropped_anchor=${droppedAnchor} dropped_dup=${droppedDup} dropped_class=${droppedClass} dropped_unit=${droppedUnit}`,
    });
    await this.deps.repo.replaceForBusiness(businessId, fp, atoms);
    return atoms;
  }
}
