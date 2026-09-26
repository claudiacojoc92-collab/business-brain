import { generateId } from '@bb/shared';
import type { EvidenceFragment } from '@bb/domain';
import type { IBusinessEvidenceLinkRepository } from '../bi/contracts';
import { bridgeFragmentsToObservations } from '../bi/bridge';
import type {
  IProofExtractionModel, IProofFactRepository, IProofFragmentSource, ProofSourceUnit,
  ProofFact, UnsourcedClaim, ProofCandidate, UnsourcedReason, ProofKind,
} from './contracts';

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** Deterministic staleness key over the bound-fragment set: re-extract only when the sources actually change. */
function fingerprint(ids: string[]): string {
  let h = 0x811c9dc5;
  for (const id of [...ids].sort()) { for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); } }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + ids.length;
}
/** Self-published performance figures / outcome statistics. */
const PERF_NUM_RE = /\b\d{1,3}(\.\d+)?\s?%|\b(satisfaction|success|improvement|recovery|retention|conversion|growth|roi)\b/i;
/** Uniqueness / superlative / ranking claims (Part B: "only", "first", "unique", "exclusive", "patented", …). */
const UNIQUE_RE = /\b(the only|only\s+\w+\s+(that|to|in|with|soft)|the first|first\s+\w+\s+(to|in)|\bsole\b|\bunique\b|\bexclusive\b|\bpatented\b|one[- ]of[- ]a[- ]kind|world[- ]class|award[- ]winning|highest[- ]rated|five[- ]star|5[- ]star|the (largest|leading|best|top)|#\s?1|no\.?\s?1|number one)/i;
const PERF_RE = new RegExp(`${PERF_NUM_RE.source}|${UNIQUE_RE.source}`, 'i');
const perfReason = (q: string): UnsourcedReason =>
  PERF_NUM_RE.test(q) ? (/(growth|increase|revenue)/i.test(q) ? 'growth_figure' : /(satisfaction|success|recovery|retention|improvement|conversion)/i.test(q) ? 'self_published_performance_figure' : 'outcome_statistic')
  : /(#\s?1|no\.?\s?1|number one|highest[- ]rated|five[- ]star|5[- ]star)/i.test(q) ? 'ranking' : 'superlative';

const CHECKABLE: ProofKind[] = ['credential', 'award', 'tenure', 'location', 'team_size', 'service_count'];

// Part B: a proofFact must be a fact about THIS business, not about a method/technique/industry in general.
const BIZ_REF_RE = /\b(we|we're|we've|our|us|the (clinic|practice|team|studio|company|office|staff|founder)|our team|founded|established|located|based in|dr\.?\s+[a-z])/i;
function aboutThisBusiness(q: string, businessName: string): boolean {
  if (BIZ_REF_RE.test(q)) return true;
  const tok = businessName.toLowerCase().split(/\s+/).filter((w) => w.length > 3)[0];
  return Boolean(tok && q.toLowerCase().includes(tok));
}
// Part B: team_size must be a clean count or short named roster, never a concatenated bio blob.
function cleanTeamSize(q: string): boolean {
  const t = q.trim();
  if (/\b\d+\b/.test(t) && t.length <= 140) return true;             // an explicit count
  const roster = t.match(/Dr\.?\s+[A-Z][a-z]+/g) ?? [];
  return roster.length >= 2 && roster.length <= 8 && t.length <= 160; // a short named roster
}

function wrap(kind: ProofKind, quote: string, attribution: string | null): string {
  const q = quote.trim().replace(/^["“”']+|["“”']+$/g, '');
  switch (kind) {
    case 'testimonial': return attribution ? `A client, ${attribution}, stated: “${q}”` : `A client stated: “${q}”`;
    case 'case_study': return `A case study on the site describes ${attribution ?? 'a named client'}: “${q}”`;
    case 'external_sourced_figure': return `Per ${attribution ?? 'a cited external source'}, the site reports: “${q}”`;
    default: return `The site states: “${q}”`; // credential/award/tenure/location/team_size/service_count — checkable, reported as published
  }
}

export class ProofExtractionService {
  constructor(private readonly deps: {
    links: IBusinessEvidenceLinkRepository;
    evidence: IProofFragmentSource;
    model: IProofExtractionModel;
    repo: IProofFactRepository;
    modelId?: string;
    log?: (e: { type: string; detail?: string }) => void;
  }) {}

  /** Licensable proof strings for the authority set (wrapped, reported-speech). Extracts + caches by fingerprint. */
  async factStrings(businessId: string, businessName: string): Promise<string[]> {
    const facts = await this.facts(businessId, businessName);
    return facts.map((f) => f.licensedText);
  }

  /** The verified proof facts (cached unless the bound source set changed). */
  async facts(businessId: string, businessName: string): Promise<ProofFact[]> {
    const ids = await this.deps.links.listFragmentIds(businessId);
    const fp = fingerprint(ids);
    if ((await this.deps.repo.latestFingerprint(businessId)) === fp) return this.deps.repo.listProof(businessId);
    if (ids.length === 0) { await this.deps.repo.replaceForBusiness(businessId, fp, [], []); return []; }

    const frags = await this.deps.evidence.findByIds(ids);
    const units = this.toUnits(frags);
    if (units.length === 0) { await this.deps.repo.replaceForBusiness(businessId, fp, [], []); return []; }

    let out: { proofs: ProofCandidate[]; unsourced: { claimText: string; anchorQuote: string; exclusionReason: UnsourcedReason; sourceRef: string }[] };
    try { out = await this.deps.model.extract({ businessName, units }); }
    catch { this.deps.log?.({ type: 'proof_extract_threw' }); return this.deps.repo.listProof(businessId); }

    const unitByRef = new Map(units.map((u) => [u.sourceRef, u]));
    const now = new Date().toISOString();
    const proofs: ProofFact[] = [];
    const unsourced: UnsourcedClaim[] = [];
    const seen = new Set<string>();

    for (const c of out.proofs) {
      const unit = unitByRef.get(c.sourceRef);
      if (!unit) continue;
      // DETERMINISTIC ANCHOR CHECK — the quote MUST appear verbatim in the cited unit, else drop (no hallucinated proof).
      if (!c.anchorQuote || !norm(unit.text).includes(norm(c.anchorQuote))) { this.deps.log?.({ type: 'proof_anchor_dropped', detail: c.anchorQuote?.slice(0, 60) }); continue; }
      const key = norm(c.anchorQuote); if (seen.has(key)) continue; seen.add(key);
      const ext = (c.externalSource ?? '').trim();
      // DETERMINISTIC CLASSIFICATION GUARD (Amendment 2): a performance figure / superlative with NO named external
      // source is NEVER proof — route it to unsourced regardless of the model's kind. Testimonials/checkable facts/
      // named case studies pass. An externally-sourced figure passes AS external_sourced_figure carrying the source.
      const looksPerf = PERF_RE.test(c.anchorQuote);
      const kindOk = c.kind === 'testimonial' || c.kind === 'case_study' || CHECKABLE.includes(c.kind);
      if (looksPerf && !ext && !(c.kind === 'testimonial')) {
        unsourced.push({ id: generateId(), businessId, claimText: c.anchorQuote.trim(), anchorQuote: c.anchorQuote.trim(), exclusionReason: perfReason(c.anchorQuote), sourceRef: unit.sourceRef, sourceUrl: unit.sourceUrl, sourceFingerprint: fp, extractedAt: now });
        continue;
      }
      const kind: ProofKind = ext ? 'external_sourced_figure' : (kindOk ? c.kind : 'testimonial');
      if (kind === 'case_study' && !(c.attribution ?? '').trim()) continue; // case study requires a named client
      // Part B: checkable facts (credential/award/tenure/team_size/service_count) must be about THIS business,
      // not a modality/industry-general statement. Locations (addresses) and externally-sourced figures are
      // inherently business-specific; testimonials are client statements about the business.
      if (CHECKABLE.includes(kind) && kind !== 'location' && !ext && !aboutThisBusiness(c.anchorQuote, businessName)) {
        this.deps.log?.({ type: 'proof_not_about_business', detail: c.anchorQuote.slice(0, 60) }); continue;
      }
      // Part B: team_size must resolve to a clean count / short roster, else drop.
      if (kind === 'team_size' && !cleanTeamSize(c.anchorQuote)) { this.deps.log?.({ type: 'proof_teamsize_unclean', detail: c.anchorQuote.slice(0, 60) }); continue; }
      const attribution = ext || (c.attribution ?? '').trim() || null;
      proofs.push({ id: generateId(), businessId, kind, licensedText: wrap(kind, c.anchorQuote, attribution), anchorQuote: c.anchorQuote.trim(), attribution, sourceRef: unit.sourceRef, sourceUrl: unit.sourceUrl, sourceFingerprint: fp, modelId: this.deps.modelId ?? null, extractedAt: now });
    }
    for (const u of out.unsourced) {
      const unit = unitByRef.get(u.sourceRef);
      if (!unit || !u.anchorQuote || !norm(unit.text).includes(norm(u.anchorQuote))) continue;
      const key = 'U:' + norm(u.anchorQuote); if (seen.has(key)) continue; seen.add(key);
      unsourced.push({ id: generateId(), businessId, claimText: u.claimText.trim(), anchorQuote: u.anchorQuote.trim(), exclusionReason: u.exclusionReason, sourceRef: unit.sourceRef, sourceUrl: unit.sourceUrl, sourceFingerprint: fp, extractedAt: now });
    }

    await this.deps.repo.replaceForBusiness(businessId, fp, proofs, unsourced);
    this.deps.log?.({ type: 'proof_extracted', detail: `proofs=${proofs.length} unsourced=${unsourced.length}` });
    return proofs;
  }

  listUnsourced(businessId: string): Promise<UnsourcedClaim[]> { return this.deps.repo.listUnsourced(businessId); }

  /** Project bound fragments into readable source units WITH resolvable provenance (page/doc level, url never empty). */
  private toUnits(frags: EvidenceFragment[]): ProofSourceUnit[] {
    const units: ProofSourceUnit[] = [];
    // Declared/handed material (brochures, PDFs, IG) — page/doc text with a founder:// or platform URI.
    for (const f of frags) {
      if (f.source === 'website') continue;
      const payload = (f.payload ?? {}) as Record<string, unknown>;
      if (payload['kind'] === 'block') continue;
      const text = typeof payload['text'] === 'string' ? (payload['text'] as string).trim() : '';
      if (!text) continue;
      const ref = typeof payload['ref'] === 'string' && payload['ref'] ? (payload['ref'] as string) : (f.source === 'instagram' ? 'Instagram' : 'Uploaded material');
      units.push({ sourceRef: `${ref}`, sourceUrl: f.sourceUrl ?? `founder://supplied/${f.id}`, pageType: typeof payload['pageType'] === 'string' ? (payload['pageType'] as string) : f.source, text });
    }
    // Observed website pages — same projection the understanding synthesis read (deduped, readable refs + real url).
    for (const o of bridgeFragmentsToObservations(frags.filter((f) => f.source === 'website'), '')) {
      const text = (o.text ?? '').trim();
      if (!text || /sitemap|\.xml(?:$|\?)|\/robots\.txt/i.test(o.url)) continue;
      units.push({ sourceRef: o.ref, sourceUrl: o.url || `source://${o.ref}`, pageType: o.pageType ?? 'website', text });
    }
    // De-dup by sourceRef (bridge refs are stable); keep first.
    const byRef = new Map<string, ProofSourceUnit>();
    for (const u of units) if (!byRef.has(u.sourceRef)) byRef.set(u.sourceRef, u);
    return [...byRef.values()];
  }
}
