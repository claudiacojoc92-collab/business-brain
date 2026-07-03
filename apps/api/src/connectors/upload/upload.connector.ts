/**
 * Upload connector (M2.2). Implements the SAME standard connector contract as the website
 * connector (spec §6) — full method surface (authorize/capabilities/sync/normalize/
 * produceEvidence/status/disconnect), not a special-cased endpoint, so the plug-in
 * architecture holds. Its only output is observed evidence appended through the UNCHANGED
 * honesty gate. It never calls the engine or reaches downstream.
 *
 * Provenance in the existing schema (no migration): source='upload'; source_url = an OPAQUE
 * synthetic document-location URI (satisfies observed_has_source AND is the resolvable anchor —
 * it is NEVER dereferenced/fetched, only compared); visibility='private'; payload carries the
 * document identity + anchor.
 */
import { makeFragment, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { assertWithinBounds, detectType, UploadBoundsError } from './detect';
import { extractPdf, extractDocx, extractText } from './extract';
import { classifyUnits } from './classify';
import type {
  Anchor, ClassifiedUnit, DetectedType, ExtractedDoc, UploadInput, UploadReadResult, UploadState,
} from './types';

export interface Capabilities { read: boolean; insights: boolean; publish: boolean }

/** Opaque, resolvable document-location key used as source_url. Never dereferenced/fetched. */
export function anchorKey(a: Anchor): string {
  if (a.kind === 'page') return `page=${a.page}`;
  if (a.kind === 'section') return `section=${encodeURIComponent(a.section ?? '')}`;
  if (a.kind === 'paragraph') return `paragraph=${a.paragraph}`;
  return 'document';
}
export function docLocationUri(hash: string, filename: string, a: Anchor): string {
  return `upload://${hash}/${encodeURIComponent(filename)}#${anchorKey(a)}`;
}

export interface SyncResult { type: DetectedType; doc: ExtractedDoc | null; error?: string }

export class UploadConnector {
  private state: UploadState = 'reading';
  constructor(private readonly repo: IEvidenceRepository) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async authorize(): Promise<void> { /* no-op: upload is unauthenticated (like website) */ }

  capabilities(): Capabilities { return { read: true, insights: false, publish: false }; }
  supportedTypes(): string[] { return ['pdf', 'docx', 'text']; }
  status(): UploadState { return this.state; }

  /** sync: intake → bounds → content-based type detection → route to extractor → structured content. */
  async sync(input: UploadInput): Promise<SyncResult> {
    let type: DetectedType;
    try {
      assertWithinBounds(input.bytes);
      type = detectType(input.bytes);
    } catch (e) {
      this.state = 'failed';
      return { type: 'unsupported', doc: null, error: e instanceof UploadBoundsError ? e.message : 'could not read file' };
    }
    if (type === 'unsupported') { this.state = 'unsupported'; return { type, doc: null }; }
    try {
      const doc = type === 'pdf' ? await extractPdf(input.bytes, input.filename)
        : type === 'docx' ? await extractDocx(input.bytes, input.filename)
          : extractText(input.bytes, input.filename);
      return { type, doc };
    } catch (e) {
      this.state = 'failed';
      return { type, doc: null, error: e instanceof Error ? e.message : 'parse error' };
    }
  }

  /** normalize: classify each unit — provenance type (redundancy vs existing observed) + strength. */
  async normalize(founderId: string, doc: ExtractedDoc): Promise<ClassifiedUnit[]> {
    const existing = await this.repo.findObserved(founderId);
    const texts = existing.map((f) => String(f.payload?.['text'] ?? '')).filter(Boolean);
    return classifyUnits(doc.units, texts);
  }

  /** produceEvidence: emit observed-artifact fragments through the UNCHANGED gate. Redundant → nothing. */
  async produceEvidence(founderId: string, doc: ExtractedDoc, classified: ClassifiedUnit[]): Promise<{ stored: number; deduped: number; redundantUnits: number }> {
    const fragments: EvidenceFragment[] = [];
    let redundantUnits = 0;
    for (const c of classified) {
      if (c.provenanceType === 'redundant') { redundantUnits++; continue; } // emits nothing new (§5.3)
      const uri = docLocationUri(doc.contentHash, doc.filename, c.unit.anchor);
      const common = {
        founderId, source: 'upload', platform: null, sourceUrl: uri,
        confidenceKind: 'observed' as const, visibility: 'private' as const, occurredAt: null as Date | null,
      };
      const sourceDocument = { filename: doc.filename, contentHash: doc.contentHash };
      fragments.push(makeFragment({ ...common, payload: {
        text: c.unit.text, sourceDocument, anchor: c.unit.anchor, docType: doc.type, provenanceStrength: doc.provenanceStrength,
      } }));
      for (const b of c.unit.blocks) {
        fragments.push(makeFragment({ ...common, payload: {
          kind: 'block', text: b.text, blockType: b.blockType, anchor: c.unit.anchor, sourceDocument,
        } }));
      }
    }
    const { stored, deduped } = fragments.length ? await this.repo.appendMany(fragments) : { stored: 0, deduped: 0 };
    return { stored, deduped, redundantUnits };
  }

  async disconnect(founderId: string): Promise<void> { await this.repo.deleteBySource(founderId, 'upload'); }
}

/**
 * Orchestrator: runs the connector contract (sync → normalize → produceEvidence) and resolves
 * an honest state. STOPS at the evidence boundary (no recompute/reflection — that is the payoff).
 */
export async function readUpload(args: { founderId: string; input: UploadInput; repo: IEvidenceRepository }): Promise<UploadReadResult> {
  const { founderId } = args;
  const { filename } = args.input;
  const conn = new UploadConnector(args.repo);
  const base = (over: Partial<UploadReadResult>): UploadReadResult => ({
    state: 'failed', founderId, filename, type: 'unsupported', provenanceStrength: null,
    unitsRead: 0, fragmentsStored: 0, fragmentsDeduped: 0, redundantUnits: 0, ...over,
  });

  const { type, doc, error } = await conn.sync(args.input);
  if (error) return base({ state: 'failed', type, error });     // bounds/parse failure
  if (type === 'unsupported') return base({ state: 'unsupported', type }); // detected-unsupported type
  if (!doc) return base({ state: 'failed', type });
  if (doc.empty || doc.units.length === 0) return base({ state: 'empty', type, provenanceStrength: doc.provenanceStrength, unitsRead: doc.units.length });

  const classified = await conn.normalize(founderId, doc);
  const { stored, deduped, redundantUnits } = await conn.produceEvidence(founderId, doc, classified);

  let state: UploadState;
  if (redundantUnits === doc.units.length) state = 'redundant';
  else if (redundantUnits > 0) state = 'partial';
  else state = 'synced';

  return { state, founderId, filename, type, provenanceStrength: doc.provenanceStrength, unitsRead: doc.units.length, fragmentsStored: stored, fragmentsDeduped: deduped, redundantUnits };
}
