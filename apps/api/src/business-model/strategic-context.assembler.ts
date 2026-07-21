/**
 * Wave 4 — read-only StrategicContextAssembler. Produces a typed, explicit, bounded context package for the
 * strategist. It REUSES the existing eligibility rules (never re-derives them): current Business Understanding
 * with EFFECTIVE founder responses, and current eligible Public Positioning Context via effectiveMarketContext
 * (confirmed entity + latest READY review + website-change validity + accuracy≠no + relevance). No raw DB dumps,
 * no dismissed entities, no superseded responses, no unverified suggested entities, no obsolete post-website-
 * change findings. Deterministic ordering; bounded payload with explicit truncation; no credentials.
 */
import type { PgUnderstandingRepository } from './pg-understanding.repository';
import type { PgConclusionResponseRepository } from './pg-conclusion-response.repository';
import type { PgMarketEntityRepository, PgMarketFindingRepository } from './pg-market.repository';
import type { PgMarketFindingResponseRepository } from './pg-market-finding-response.repository';
import type { PgMarketReviewRepository } from './pg-market-review.repository';
import { effectiveMarketContext, listEntityViews } from './market-context.service';
import { groupOf, GROUP_ORDER, type ConclusionType, type EpistemicStatus } from './understanding';
import type { StrategicSubtype } from './strategy';
import type { PgFounderStrategicContextRepository } from './pg-founder-strategic-context.repository';
import { resolveEffectiveStrategicContext, type EffectiveContextItem, type StrategicContextConflict, type ContextHealthItem, type MissingContextArea } from './effective-strategic-context.resolver';
import type { FrozenPromotedLearning } from './context-snapshot';

const CAP = { conclusions: 15, observations: 20, inferences: 20, provenance: 20 };

export interface StrategicContext {
  businessUnderstanding: {
    version: number | null;
    conclusions: Array<{ id: string; type: string; statement: string; epistemicStatus: string; group: string; evidenceCount: number }>;
    founderResponses: Array<{ conclusionId: string; type: string; acceptedText: string | null; qualificationText: string | null; correctionText: string | null; revisedEarlier: boolean }>;
    conflicts: Array<{ conclusionId: string; observation: string; founderCorrection: string }>;
    unknowns: Array<{ conclusionId: string; statement: string }>;
  };
  publicPositioningContext: {
    entities: Array<{ id: string; name: string; entityType: string; websiteUrl: string | null }>;
    observations: Array<{ findingId: string; entityId: string; sourceUrl: string; text: string; accuracy: string; relevance: string; relevanceQualification: string | null }>;
    inferences: Array<{ findingId: string; entityId: string; text: string; epistemicStatus: string; accuracy: string; relevance: string }>;
    provisional: { observations: number; inferences: number };
    provenance: Array<{ findingId: string; reviewId: string | null; adapter: string; model: string | null; promptVersion: string | null }>;
  };
  founderContext: {
    goals: EffectiveContextItem[]; constraints: EffectiveContextItem[]; resources: EffectiveContextItem[];
    strategicPreferences: EffectiveContextItem[]; decisionHorizons: EffectiveContextItem[];
    conflicts: StrategicContextConflict[]; staleItems: ContextHealthItem[]; missingCriticalAreas: MissingContextArea[];
    // ADR-014 Consumption Gate: promoted learning revisions that a frozen snapshot carries into reasoning (additive;
    // undefined on the live path). Kept distinct from native founder-declared context.
    promotedLearnings?: FrozenPromotedLearning[];
  };
  question: { rawText: string; normalizedStrategicJob: 'PRIORITY_DECISION'; subtype: StrategicSubtype; decisionHorizon: string };
  contextHealth: { missingAreas: string[]; staleAreas: string[]; contradictoryAreas: string[]; truncated: boolean };
}

export interface AssemblerDeps {
  understanding: PgUnderstandingRepository;
  conclusionResponses: PgConclusionResponseRepository;
  entities: PgMarketEntityRepository;
  findings: PgMarketFindingRepository;
  findingResponses: PgMarketFindingResponseRepository;
  reviews: PgMarketReviewRepository;
  strategicContext: PgFounderStrategicContextRepository;
}

function decisionHorizon(q: string): string {
  if (/\bnext (?:30|thirty) days\b|\b30[- ]day\b/i.test(q)) return '30 days';
  if (/\bnext (?:90|ninety) days|\bquarter\b/i.test(q)) return '90 days';
  if (/\bnow\b|\btoday\b|\bthis week\b/i.test(q)) return 'immediate';
  return 'unspecified';
}

const UNKNOWN_TYPES: ReadonlySet<string> = new Set(['missing_information', 'strategic_question']);

export async function assembleStrategicContext(founderId: string, rawQuestion: string, subtype: StrategicSubtype, deps: AssemblerDeps, asOf: Date = new Date(), frozen?: { businessUnderstanding: StrategicContext['businessUnderstanding']; founderContext: StrategicContext['founderContext']; publicPositioningContext: StrategicContext['publicPositioningContext'] }): Promise<StrategicContext> {
  const missingAreas: string[] = []; const staleAreas: string[] = []; const contradictoryAreas: string[] = []; let truncated = false;

  // ── Business Understanding ────────────────────────────────────────────────────────────────────────────
  // ADR-014 Consumption Gate: when a FROZEN snapshot is supplied, reasoning consumes it verbatim — the live BU read is
  // skipped entirely. Otherwise the pre-existing live path (latest version + EFFECTIVE responses) runs unchanged.
  const buConclusions: StrategicContext['businessUnderstanding']['conclusions'] = [];
  const founderResponses: StrategicContext['businessUnderstanding']['founderResponses'] = [];
  const conflicts: StrategicContext['businessUnderstanding']['conflicts'] = [];
  const unknowns: StrategicContext['businessUnderstanding']['unknowns'] = [];
  let buVersion: number | null = null;
  if (!frozen) {
    const u = await deps.understanding.latest(founderId);
    buVersion = u?.version ?? null;
    const effResp = await deps.conclusionResponses.effectiveByConclusion(founderId);
    const revised = await deps.conclusionResponses.revisedConclusionIds(founderId);
    if (!u || u.conclusions.length === 0) { missingAreas.push('business_understanding'); }
    else {
      // deterministic order: canonical group order, then stable id
      const ordered = [...u.conclusions].sort((a, b) => (GROUP_ORDER.indexOf(groupOf(a.type, a.epistemicStatus)) - GROUP_ORDER.indexOf(groupOf(b.type, b.epistemicStatus))) || a.id.localeCompare(b.id));
      for (const c of ordered) {
        if (buConclusions.length >= CAP.conclusions) { truncated = true; break; }
        buConclusions.push({ id: c.id, type: c.type, statement: c.statement, epistemicStatus: c.epistemicStatus, group: groupOf(c.type as ConclusionType, c.epistemicStatus as EpistemicStatus), evidenceCount: c.evidenceRefs.length });
        const r = effResp.get(c.id);
        if (r) {
          founderResponses.push({ conclusionId: c.id, type: r.type, acceptedText: r.acceptedText, qualificationText: r.qualificationText, correctionText: r.correctionText, revisedEarlier: revised.has(c.id) });
          if (r.type === 'corrected' && r.correctionText) conflicts.push({ conclusionId: c.id, observation: c.statement, founderCorrection: r.correctionText });
        }
        if (c.epistemicStatus === 'NEEDS_MORE_EVIDENCE' || UNKNOWN_TYPES.has(c.type)) unknowns.push({ conclusionId: c.id, statement: c.statement });
      }
      if (conflicts.length) contradictoryAreas.push('business_understanding_corrections');
    }
  } else if (frozen.businessUnderstanding.conclusions.length === 0) {
    missingAreas.push('business_understanding');
  }

  // ── Public Positioning Context ────────────────────────────────────────────────────────────────────────
  // ADR-014 remediation: when FROZEN, consume the snapshot's public-positioning verbatim — the live market-context reads
  // (effectiveMarketContext / findings / entity views) are skipped entirely so a snapshot-bound generation reads nothing
  // live. Otherwise the pre-existing live path runs unchanged.
  let publicPositioningContext: StrategicContext['publicPositioningContext'];
  if (frozen) {
    publicPositioningContext = frozen.publicPositioningContext;
    if (publicPositioningContext.entities.length === 0 && publicPositioningContext.observations.length === 0 && publicPositioningContext.inferences.length === 0) missingAreas.push('public_positioning');
  } else {
    const ctx = await effectiveMarketContext(founderId, deps.entities, deps.findings, deps.findingResponses, deps.reviews);
    let obs = [...ctx.observed].sort((a, b) => a.id.localeCompare(b.id));
    let inf = [...ctx.inferences].sort((a, b) => a.id.localeCompare(b.id));
    if (obs.length > CAP.observations) { obs = obs.slice(0, CAP.observations); truncated = true; }
    if (inf.length > CAP.inferences) { inf = inf.slice(0, CAP.inferences); truncated = true; }
    if (ctx.confirmedEntities.length === 0 && obs.length === 0 && inf.length === 0) missingAreas.push('public_positioning');
    if (obs.some((o) => o.accuracy === 'partly') || inf.some((i) => i.accuracy === 'partly')) contradictoryAreas.push('public_positioning_partial_accuracy');
    const usableIds = new Set([...obs.map((o) => o.id), ...inf.map((i) => i.id)]);
    const allFindings = await deps.findings.listByFounder(founderId);
    const provenance = allFindings.filter((f) => usableIds.has(f.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, CAP.provenance)
      .map((f) => ({ findingId: f.id, reviewId: f.reviewId, adapter: f.retrievalAdapter, model: f.modelVersion, promptVersion: f.promptVersion }));
    const entityViews = await listEntityViews(founderId, deps.entities, deps.reviews);
    if (entityViews.some((e) => e.needsFreshReview)) staleAreas.push('public_positioning_website_changed');
    publicPositioningContext = {
      entities: ctx.confirmedEntities.map((e) => ({ id: e.id, name: e.name, entityType: e.entityType, websiteUrl: e.websiteUrl })),
      observations: obs.map((o) => ({ findingId: o.id, entityId: o.entityId, sourceUrl: o.sourceUrl, text: o.observedText, accuracy: o.accuracy, relevance: o.relevance, relevanceQualification: o.relevanceQualification })),
      inferences: inf.map((i) => ({ findingId: i.id, entityId: i.entityId, text: i.inferenceText, epistemicStatus: i.epistemicStatus, accuracy: i.accuracy, relevance: i.relevance })),
      provisional: { observations: ctx.provisional.observed.length, inferences: ctx.provisional.inferences.length },
      provenance,
    };
  }

  // ── Founder Strategic Context ─────────────────────────────────────────────────────────────────────────
  // Frozen path: consume the snapshot's founder context verbatim. Live path: the effective resolver (ACTIVE + not-future
  // + not-expired + latest-version only; 'ANY' scope — a priority decision is holistic).
  let founderContext: StrategicContext['founderContext'];
  if (frozen) {
    founderContext = frozen.founderContext;
    if (founderContext.missingCriticalAreas.length > 0) missingAreas.push('founder_strategic_context_incomplete');
    if (founderContext.conflicts.length > 0) contradictoryAreas.push('founder_strategic_context_conflicts');
  } else {
    const eff = resolveEffectiveStrategicContext(await deps.strategicContext.listActive(founderId), asOf, 'ANY');
    if (eff.missingCriticalAreas.length > 0) missingAreas.push('founder_strategic_context_incomplete');
    if (eff.conflicts.length > 0) contradictoryAreas.push('founder_strategic_context_conflicts');
    if (eff.staleItems.some((s) => s.reason === 'EXPIRED' || s.reason === 'REVIEW_DUE')) staleAreas.push('founder_strategic_context_review_due');
    founderContext = { goals: eff.goals, constraints: eff.constraints, resources: eff.resources, strategicPreferences: eff.strategicPreferences, decisionHorizons: eff.decisionHorizons, conflicts: eff.conflicts, staleItems: eff.staleItems, missingCriticalAreas: eff.missingCriticalAreas };
  }

  const businessUnderstanding = frozen ? frozen.businessUnderstanding : { version: buVersion, conclusions: buConclusions, founderResponses, conflicts, unknowns };

  return {
    businessUnderstanding,
    publicPositioningContext,
    founderContext,
    question: { rawText: rawQuestion.slice(0, 1000), normalizedStrategicJob: 'PRIORITY_DECISION', subtype, decisionHorizon: decisionHorizon(rawQuestion) },
    contextHealth: { missingAreas, staleAreas, contradictoryAreas, truncated },
  };
}
