import { createHash } from 'node:crypto';
import { generateId } from '@bb/shared';
import { detectMaterialLanguage, detectTextLanguage, toLocale, type IContentLanguageStore } from '../business/content-language';
import {
  type IEvidenceRepository,
  type RawCaptureRepository,
  type ObservationRepository,
  type RevisionRepository,
  type Clock,
  type SubjectRef,
  type RawCapture,
  type WebObservation,
  type CorpusRevision,
  type EvidenceFragment,
  makeFragment,
  buildRawCapture,
  buildWebObservation,
  corpusRevisionId,
  WEB_NORMALIZATION_RULE_VERSION,
} from '@bb/domain';
import {
  UNDERSTANDING_PROFILE_VERSION,
  SUPPLIED_UNDERSTANDING_PROFILE_VERSION,
  type IWebsiteIngestionPort,
  type ISocialDiscoveryPort,
  type IUnderstandingModelPort,
  type IBusinessEvidenceLinkRepository,
  type IDiscoveredProfileRepository,
  type IUnderstandingSnapshotRepository,
  type IAhaRepository,
  type IBusinessWebsiteRepository,
  type DiscoveredProfile,
  type PageObservation,
  type ObservationProvenance,
  type WebsiteIngestionResult,
  type LearnFromMaterialParams,
} from './contracts';
import { bridgeFragmentsToObservations, webObservationsToPageObservations, suppliedMaterialToObservations, hostOf } from './bridge';
import { assertWellFormed, validateAha, type ValidatedFinding } from './validation';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface LearnBusinessDeps {
  /** The business's content language (decided once, at first understanding, from the founder's own material). */
  contentLanguage?: IContentLanguageStore;
  evidenceRepo: IEvidenceRepository;
  ingestion: IWebsiteIngestionPort;
  discovery: ISocialDiscoveryPort;
  model: IUnderstandingModelPort;
  links: IBusinessEvidenceLinkRepository;
  profiles: IDiscoveredProfileRepository;
  understanding: IUnderstandingSnapshotRepository;
  aha: IAhaRepository;
  website: IBusinessWebsiteRepository;
  // Canonical understanding-ledger repositories (the bridge writes web observations here).
  rawCaptures: RawCaptureRepository;
  observations: ObservationRepository;
  revisions: RevisionRepository;
  clock: Clock;
}

export interface LearnBusinessParams {
  businessId: string;
  founderId: string;
  businessName: string;
  url: string;
  interfaceLanguage: string;
}

export interface LearnBusinessResult {
  state: WebsiteIngestionResult['state'];
  pagesRead: number;
  error?: string;
  discovered: DiscoveredProfile[];
  understandingId?: string;
  aha: { status: 'produced' | 'insufficient'; findings: ValidatedFinding[] };
}

/**
 * Slice 1 orchestration: real website ingestion → immutable-fragment binding → CANONICAL ledger
 * write (RawCapture + web_page NormalizedObservation + corpus revision) → synthesis over the
 * ledger-backed observations → deterministic grounding/anti-transplant gate → persisted governed
 * understanding + Aha. Evidence fragments stay immutable; inference is never written as observation.
 */
export class LearnBusinessService {
  constructor(private readonly deps: LearnBusinessDeps) {}

  async learn(p: LearnBusinessParams): Promise<LearnBusinessResult> {
    await this.deps.website.setWebsite(p.businessId, p.url, 'reading');

    const ing = await this.deps.ingestion.ingest(p.founderId, p.url);
    if (ing.state === 'failed') {
      await this.deps.website.setIngestion(p.businessId, 'failed', false);
      return { state: 'failed', pagesRead: 0, error: ing.error, discovered: [], aha: { status: 'insufficient', findings: [] } };
    }

    // Bind the immutable website fragments for this business's host (idempotent; no copy/re-key).
    const host = hostOf(p.url);
    const all = await this.deps.evidenceRepo.findObserved(p.founderId, 'website');
    const forHost = all.filter((f) => (f.platform ?? '').replace(/^www\./, '') === host);
    await this.deps.links.bind(p.businessId, forHost.map((f) => ({ fragmentId: f.id, source: 'website' })));

    // Discover public profiles (best-effort; DISCOVERED, not ingested).
    try {
      const found = await this.deps.discovery.discover(p.url);
      if (found.length) await this.deps.profiles.upsertMany(p.businessId, found);
    } catch {
      /* best-effort */
    }
    const discovered = await this.deps.profiles.list(p.businessId);

    const pageObs = bridgeFragmentsToObservations(forHost, host);
    if (pageObs.length === 0) {
      const state = ing.state === 'synced' ? 'empty' : ing.state;
      await this.deps.website.setIngestion(p.businessId, state, true);
      return { state, pagesRead: ing.pagesRead, discovered, aha: { status: 'insufficient', findings: [] } };
    }

    // ── CANONICAL LEDGER WRITE: fragments → RawCapture + web_page NormalizedObservation → corpus ──
    const businessRef: SubjectRef = { type: 'business', id: p.businessId };
    const now = this.deps.clock.now();
    const captures: RawCapture[] = [];
    const webObs: WebObservation[] = [];
    for (const po of pageObs) {
      const payload = { url: po.url, title: po.title, text: po.text, pageType: po.pageType, lang: po.lang };
      const capture = buildRawCapture({ source: 'website', externalId: po.url, entry: payload, capturedAt: now });
      const observation = buildWebObservation({
        rawCaptureId: capture.id,
        payload,
        extraction: {
          ruleKey: 'web.page.bridge',
          ruleVersion: WEB_NORMALIZATION_RULE_VERSION,
          mode: 'deterministic',
          sourceLocus: po.url,
          reproducible: true,
        },
        capturedAt: now,
      });
      captures.push(capture);
      webObs.push(observation);
    }
    await this.deps.rawCaptures.appendMany(businessRef, captures);
    await this.deps.observations.appendMany(businessRef, webObs);
    const observationIds = webObs.map((o) => o.id);
    const revId = corpusRevisionId({ observationIds, activeFacetCorrectionIds: [] });
    const revision: CorpusRevision = { id: revId, businessRef, observationIds, activeFacetCorrectionIds: [], createdAt: now };
    await this.deps.revisions.bumpCorpus(businessRef, revision);

    // ── Synthesis consumes the CANONICAL ledger observations (read back), not the raw fragments. ──
    const ledgerObs = await this.deps.observations.listByCorpus(businessRef, revId);
    const ledgerWeb = ledgerObs.filter((o): o is WebObservation => o.kind === 'web_page');
    const observations: PageObservation[] = webObservationsToPageObservations(ledgerWeb);
    if (observations.length === 0) {
      await this.deps.website.setIngestion(p.businessId, ing.state, true);
      return { state: ing.state, pagesRead: ing.pagesRead, discovered, aha: { status: 'insufficient', findings: [] } };
    }

    const persisted = await this.synthesizeAndPersist(p.businessId, p.businessName, observations, p.interfaceLanguage, UNDERSTANDING_PROFILE_VERSION);

    await this.deps.website.setIngestion(p.businessId, ing.state, true);
    return {
      state: ing.state,
      pagesRead: ing.pagesRead,
      discovered,
      understandingId: persisted.understandingId,
      aha: persisted.aha,
    };
  }

  /**
   * Founder-SUPPLIED material path — the founder pastes text describing the business (bio, captions, offer
   * copy…). It persists as DECLARED evidence (never observed website evidence, never a business correction),
   * projects into DECLARED source observations, and runs the SAME synthesis + grounding + anti-transplant gate
   * as the website path. No website, no fetch, no fake page. Provenance stays honest end-to-end.
   */
  async learnFromMaterial(p: LearnFromMaterialParams): Promise<LearnBusinessResult> {
    const observations = suppliedMaterialToObservations(p.material);
    if (observations.length === 0) {
      return { state: 'empty', pagesRead: 0, discovered: [], aha: { status: 'insufficient', findings: [] } };
    }

    // Persist the supplied material as append-only DECLARED evidence (provenance record; private).
    const fragments: EvidenceFragment[] = observations.map((o) =>
      makeFragment({
        founderId: p.founderId,
        source: 'founder_supplied',
        platform: null,
        sourceUrl: o.url, // stable founder://supplied/N URI — declared, never a fetched page
        confidenceKind: 'declared',
        visibility: 'private',
        occurredAt: null,
        payload: { text: o.text, kind: 'founder_supplied' },
      }),
    );
    await this.deps.evidenceRepo.appendMany(fragments);

    const persisted = await this.synthesizeAndPersist(p.businessId, p.businessName, observations, p.interfaceLanguage, SUPPLIED_UNDERSTANDING_PROFILE_VERSION);
    return { state: 'synced', pagesRead: observations.length, discovered: [], understandingId: persisted.understandingId, aha: persisted.aha };
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────────────────
  // DAY ONE — the multi-source POUR-IN. The founder pours many sources (website, PDF/brochure, pasted link,
  // Instagram) in any order; each is ingested as business-bound, append-only evidence WITHOUT synthesizing.
  // On "Done adding — start" the bridge fires ONCE (bridgePourIn) and synthesizes over the UNION of every
  // source, so the strategist reads the COMPLETE business — never website-only, never last-source-only. This
  // EXTENDS the engine (learn/learnFromMaterial are untouched and still used by the non-arc routes).
  // ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Pour-in: ingest a WEBSITE source (observed) and bind its pages to the business. NO synthesis (fires on Done). */
  async ingestWebsiteForPourIn(p: { businessId: string; founderId: string; url: string }): Promise<{ state: WebsiteIngestionResult['state']; pagesRead: number; error?: string }> {
    await this.deps.website.setWebsite(p.businessId, p.url, 'reading');
    const ing = await this.deps.ingestion.ingest(p.founderId, p.url);
    if (ing.state === 'failed') {
      await this.deps.website.setIngestion(p.businessId, 'failed', false);
      return { state: 'failed', pagesRead: 0, error: ing.error };
    }
    const host = hostOf(p.url);
    const all = await this.deps.evidenceRepo.findObserved(p.founderId, 'website');
    const forHost = all.filter((f) => (f.platform ?? '').replace(/^www\./, '') === host);
    await this.deps.links.bind(p.businessId, forHost.map((f) => ({ fragmentId: f.id, source: 'website' })));
    const pageObs = bridgeFragmentsToObservations(forHost, host);
    const state = pageObs.length === 0 ? (ing.state === 'synced' ? 'empty' : ing.state) : ing.state;
    await this.deps.website.setIngestion(p.businessId, state, true);
    return { state, pagesRead: ing.pagesRead };
  }

  /**
   * Pour-in: ingest a TEXT source as business-bound, append-only evidence fragments. NO synthesis. Provenance is
   * honest per source: PDF/brochure and pasted-link = DECLARED (the founder handed it to BB); Instagram content
   * BB read via the Graph API = OBSERVED (same lane as the website). Each item becomes one grounded observation.
   */
  async ingestTextForPourIn(p: {
    businessId: string; founderId: string;
    source: string; provenance: ObservationProvenance;
    items: { ref: string; url: string; text: string; pageType: string }[];
  }): Promise<{ stored: number }> {
    const observed = p.provenance === 'observed';
    const fragments = p.items
      .filter((it) => it.text.trim().length > 0 && it.url.trim().length > 0)
      .map((it) => makeFragment({
        founderId: p.founderId,
        source: p.source,
        platform: observed ? p.source : null,
        sourceUrl: it.url,
        confidenceKind: observed ? 'observed' : 'declared',
        visibility: observed ? 'public' : 'private',
        occurredAt: null,
        payload: { text: it.text.slice(0, 8000), kind: p.source, ref: it.ref, pageType: it.pageType },
      }));
    if (fragments.length === 0) return { stored: 0 };
    await this.deps.evidenceRepo.appendMany(fragments);
    await this.deps.links.bind(p.businessId, fragments.map((f) => ({ fragmentId: f.id, source: p.source })));
    return { stored: fragments.length };
  }

  /**
   * The pour-in BRIDGE — fires on "Done adding — start". Reads every source bound to the business, re-projects
   * each into a grounded PageObservation (website pages = observed; declared/instagram from their fragments,
   * provenance preserved), and runs the SAME synthesis + grounding + anti-transplant gate ONCE over the UNION →
   * one understanding snapshot over the complete business. Empty (no usable text anywhere) → 'empty', no snapshot.
   */
  async bridgePourIn(p: { businessId: string; founderId: string; businessName: string; interfaceLanguage: string }): Promise<LearnBusinessResult> {
    const boundIds = new Set(await this.deps.links.listFragmentIds(p.businessId));
    const mine = (await this.deps.evidenceRepo.findByFounder(p.founderId)).filter((f) => boundIds.has(f.id));
    const websiteObs = bridgeFragmentsToObservations(mine, ''); // observed website pages (all bound hosts)
    const extra: PageObservation[] = [];
    for (const f of mine) {
      if (f.source === 'website') continue;
      const payload = (f.payload ?? {}) as Record<string, unknown>;
      if (payload['kind'] === 'block') continue;
      const text = typeof payload['text'] === 'string' ? (payload['text'] as string) : '';
      if (!text.trim()) continue;
      extra.push({
        ref: typeof payload['ref'] === 'string' && (payload['ref'] as string) ? (payload['ref'] as string) : (f.source === 'instagram' ? 'Instagram' : 'What you told me'),
        url: f.sourceUrl ?? '',
        pageType: typeof payload['pageType'] === 'string' ? (payload['pageType'] as string) : f.source,
        title: null,
        text,
        lang: null,
        provenance: f.confidenceKind === 'observed' ? 'observed' : 'declared',
      });
    }
    const union = uniqueRefs(dedupeByUrl([...websiteObs, ...extra]));
    if (union.length === 0) return { state: 'empty', pagesRead: 0, discovered: [], aha: { status: 'insufficient', findings: [] } };
    const profileVersion = union.some((o) => o.provenance === 'declared') ? SUPPLIED_UNDERSTANDING_PROFILE_VERSION : UNDERSTANDING_PROFILE_VERSION;
    const persisted = await this.synthesizeAndPersist(p.businessId, p.businessName, union, p.interfaceLanguage, profileVersion);
    return { state: 'synced', pagesRead: union.length, discovered: [], understandingId: persisted.understandingId, aha: persisted.aha };
  }

  /**
   * Shared synthesis + persistence over NORMALIZED SOURCE OBSERVATIONS (observed and/or declared) — one path,
   * not "Website Brain + Paste Brain". Runs the propose-only model, the fail-closed structural gate, the
   * deterministic grounding/anti-transplant Aha gate, then persists the governed understanding + Aha.
   */
  private async synthesizeAndPersist(
    businessId: string,
    businessName: string,
    observations: PageObservation[],
    interfaceLanguage: string,
    profileVersion: string,
  ): Promise<{ understandingId: string; aha: { status: 'produced' | 'insufficient'; findings: ValidatedFinding[] } }> {
    // CONTENT LANGUAGE, decided once per business (operator rule 2026-10-07): the stored one if already set;
    // otherwise the language of the founder's own material (website, PDFs, pasted text), stored now and fixed from
    // then on. The account locale (`interfaceLanguage`) is only the fallback when the material shows no language.
    const language = await this.decideContentLanguage(businessId, observations, interfaceLanguage);
    const out = await this.deps.model.synthesize({ businessName, observations, interfaceLanguage: language });
    assertWellFormed(out); // fail closed on malformed synthesis
    // Still undecided (no detectable material language)? The model's detected source language decides it, once.
    const detected = toLocale(out.sourceLanguage);
    if (detected && this.deps.contentLanguage) await this.deps.contentLanguage.setIfUnset(businessId, detected).catch(() => undefined);

    const modelId = out.modelId ?? 'anthropic';
    const contentHash = sha256(JSON.stringify(observations.map((o) => ({ ref: o.ref, url: o.url, text: o.text }))));

    const snap = await this.deps.understanding.save({
      id: generateId(),
      businessId,
      profileVersion,
      contentHash,
      sourceRefCount: observations.length,
      sourceLanguage: out.sourceLanguage ?? observations[0]?.lang ?? null,
      understanding: out.understanding,
      modelId,
    });

    const validated = validateAha(out.aha, observations);
    const ahaRec = await this.deps.aha.save({
      id: generateId(),
      businessId,
      understandingSnapshotId: snap.id,
      language,
      contentHash: sha256(contentHash + '|' + language + '|' + JSON.stringify(validated.findings)),
      status: validated.status,
      findings: validated.findings,
      modelId,
    });

    return { understandingId: snap.id, aha: { status: ahaRec.status, findings: ahaRec.findings } };
  }

  private async decideContentLanguage(businessId: string, observations: PageObservation[], fallback: string): Promise<string> {
    const store = this.deps.contentLanguage;
    if (!store) return fallback;
    const stored = await store.get(businessId).catch(() => null);
    if (stored) return stored;
    // Website pages carry a detected `lang`; typed/pasted/uploaded text does not, so read the material's own text.
    const material = detectMaterialLanguage(observations.map((o) => o.lang))
      ?? detectTextLanguage(observations.map((o) => o.text).join('\n').slice(0, 6000));
    if (material) { await store.setIfUnset(businessId, material).catch(() => undefined); return material; }
    return fallback;
  }
}

/** Dedupe observations by url (a re-added source is a no-op), keeping the first; urlless entries are all kept. */
function dedupeByUrl(obs: PageObservation[]): PageObservation[] {
  const seen = new Set<string>();
  const out: PageObservation[] = [];
  for (const o of obs) {
    const u = (o.url ?? '').trim();
    if (u) {
      if (seen.has(u)) continue;
      seen.add(u);
    }
    out.push(o);
  }
  return out;
}

/** Make refs unique across the whole union (grounding cites refs) — a duplicate ref gets a " (n)" suffix. */
function uniqueRefs(obs: PageObservation[]): PageObservation[] {
  const counts = new Map<string, number>();
  return obs.map((o) => {
    const n = (counts.get(o.ref) ?? 0) + 1;
    counts.set(o.ref, n);
    return n === 1 ? o : { ...o, ref: `${o.ref} (${n})` };
  });
}
