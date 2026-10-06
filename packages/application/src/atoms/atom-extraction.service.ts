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
/** The FIRST verbatim span of `needle` in `raw` (folded, whitespace-insensitive), or null. Never fuzzy. */
function locate(raw: string, needle: string): { start: number; end: number } | null {
  const N = normalizeNeedle(needle);
  if (!N) return null;
  const { f, starts, ends } = buildFolded(raw);
  const idx = f.indexOf(N);
  if (idx === -1) return null;
  return { start: starts[idx] as number, end: ends[idx + N.length - 1] as number };
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

    const units = toSourceUnits(await this.deps.evidence.findByIds(ids));
    if (units.length === 0) { await this.deps.repo.replaceForBusiness(businessId, fp, []); return []; }

    let proposals;
    try { proposals = (await this.deps.model.extract({ units })).atoms; }
    catch { this.deps.log?.({ type: 'atoms_extract_threw' }); return this.deps.repo.listAtoms(businessId); }

    const unitByRef = new Map(units.map((u) => [u.sourceRef, u]));
    const atoms: BusinessAtom[] = [];
    const seen = new Set<string>();
    const now = this.now();
    let droppedClass = 0, droppedUnit = 0, droppedAnchor = 0, droppedDup = 0;

    for (const c of proposals) {
      if (!ATOM_CLASSES.includes(c.atomClass as AtomClass)) { droppedClass++; continue; } // closed scope
      const unit = unitByRef.get(c.sourceRef);
      if (!unit) { droppedUnit++; continue; }
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
