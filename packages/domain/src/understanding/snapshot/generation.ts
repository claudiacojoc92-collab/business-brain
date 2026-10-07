import {
  scopeFingerprint,
  snapshotSemanticKey,
  statementVersionId,
  businessSnapshotVersionId,
} from '../shared/identity';
import type { Scalar, ScopeDescription, SubjectRef, Timestamp } from '../shared/types';
import type { CorpusRevisionId, DeclarationRevisionId } from '../revisions/revision-ids';
import type { Facet, FacetKind } from '../facets/facet';
import type { DeclaredContextView } from '../declarations/declared-context-view';
import type { DescriptiveConfidence, SnapshotStatement } from './snapshot-statement';
import type { BusinessSnapshotVersion } from './business-snapshot-version';

/* ── Pinned constants (frozen Design Check) ── */
export const GENERATION_PROFILE_VERSION = 'understanding.snapshot.physio_movement.v1';
export const CANONICALIZATION_VERSION = '1';
export const DEFINITION_VERSION = 1;

const CHANNEL_INSTAGRAM: SubjectRef = { type: 'channel', id: 'instagram' };

/**
 * The exact three-definition Commit 4 catalog. Descriptive, observable-only. FacetKind→statement
 * mapping; fine-grained signals carried in the facet `value`, individuating semantic params carry
 * ONLY the proposition identity (theme / offerType) — never evidence statistics.
 */
interface SnapshotDefinition {
  readonly definitionKey: string;
  readonly slot: number; // final-ordering slot
  readonly facetKind: FacetKind;
  readonly facetValue?: string; // fixed value (educational); otherwise any value of the kind
  readonly minSupport: number;
  readonly maxInstances: number;
  readonly primaryParamKey?: string;
  subjectFor(value: string): SubjectRef;
  paramsFor(value: string): Record<string, Scalar>;
}

export const SNAPSHOT_DEFINITIONS: readonly SnapshotDefinition[] = [
  {
    definitionKey: 'snapshot.channel.activity_theme_recurs',
    slot: 0,
    facetKind: 'activity_theme',
    minSupport: 2,
    maxInstances: 3,
    primaryParamKey: 'theme',
    subjectFor: () => CHANNEL_INSTAGRAM,
    paramsFor: (value) => ({ theme: value }),
  },
  {
    definitionKey: 'snapshot.offer_mention_observed',
    slot: 1,
    facetKind: 'offer_mention',
    minSupport: 1,
    maxInstances: 3,
    primaryParamKey: 'offerType',
    subjectFor: (value) => ({ type: 'offer', id: value }),
    paramsFor: (value) => ({ offerType: value }),
  },
  {
    definitionKey: 'snapshot.channel.educational_explanation_recurs',
    slot: 2,
    facetKind: 'communication_style',
    facetValue: 'educational',
    minSupport: 2,
    maxInstances: 1,
    subjectFor: () => CHANNEL_INSTAGRAM,
    paramsFor: () => ({}),
  },
];

const CONF_RANK: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };
const DESC_RANK: Record<DescriptiveConfidence, number> = { clear: 4, appears: 3, tentative: 2, unknown: 1 };

/** Confidence precedence (frozen): all-low first, then clear, appears, single→tentative, else omit. */
export function deriveConfidence(input: {
  supportCount: number;
  coverageBps: number;
  allLow: boolean;
}): DescriptiveConfidence | null {
  if (input.allLow) return 'tentative';
  if (input.supportCount >= 4 && input.coverageBps >= 2500) return 'clear';
  if (input.supportCount >= 2 && input.coverageBps >= 1000) return 'appears';
  if (input.supportCount === 1) return 'tentative';
  return null;
}

/** Deterministic scope: sources sorted-unique, window = "min/max occurredAt", corpusSize = obs count. */
export function buildScope(input: {
  sources: readonly string[];
  occurredAts: readonly string[];
  corpusSize: number;
}): ScopeDescription {
  const sorted = [...input.occurredAts].sort();
  const min = sorted[0] ?? '';
  const max = sorted[sorted.length - 1] ?? '';
  return {
    sources: Array.from(new Set(input.sources)).sort(),
    window: `${min}/${max}`,
    corpusSize: input.corpusSize,
  };
}

interface Aggregate {
  kind: FacetKind;
  value: string;
  supportCount: number;
  bestConfRank: number;
  allLow: boolean;
}

function aggregateFacets(facets: readonly Facet[]): Map<string, Aggregate> {
  const byKey = new Map<string, { obs: Set<string>; confs: number[] }>();
  for (const f of facets) {
    const key = `${f.kind}::${f.value}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { obs: new Set(), confs: [] };
      byKey.set(key, acc);
    }
    acc.obs.add(f.observationId);
    acc.confs.push(CONF_RANK[f.confidence]);
  }
  const out = new Map<string, Aggregate>();
  for (const [key, acc] of byKey) {
    const [kind, value] = key.split('::') as [FacetKind, string];
    out.set(key, {
      kind,
      value,
      supportCount: acc.obs.size,
      bestConfRank: Math.max(...acc.confs),
      allLow: acc.confs.every((c) => c === CONF_RANK.low),
    });
  }
  return out;
}

interface Selected {
  statement: SnapshotStatement;
  slot: number;
  supportCount: number;
  descRank: number;
  primary: string; // primary param value for ordering ('' when none)
}

/**
 * Generate the immutable observedStatements for a corpus. Pure and deterministic. supportCount and
 * coverageBps are internal generation values only (never persisted in params / semanticKey).
 */
export function generateSnapshotStatements(input: {
  corpusRevision: CorpusRevisionId;
  understandingContextRevision: DeclarationRevisionId;
  effectiveFacets: readonly Facet[];
  scope: ScopeDescription;
}): SnapshotStatement[] {
  const aggregates = aggregateFacets(input.effectiveFacets);
  const facetsByObs = groupObservations(input.effectiveFacets);
  const sfp = scopeFingerprint(input.scope);
  const corpusSize = input.scope.corpusSize;
  const selected: Selected[] = [];

  for (const def of SNAPSHOT_DEFINITIONS) {
    const candidates: Array<Aggregate & { confidence: DescriptiveConfidence; obsIds: string[] }> = [];
    for (const agg of aggregates.values()) {
      if (agg.kind !== def.facetKind) continue;
      if (def.facetValue !== undefined && agg.value !== def.facetValue) continue;
      if (agg.supportCount < def.minSupport) continue; // definition eligibility
      const coverageBps = corpusSize > 0 ? Math.round((agg.supportCount * 10000) / corpusSize) : 0;
      const confidence = deriveConfidence({ supportCount: agg.supportCount, coverageBps, allLow: agg.allLow });
      if (confidence === null) continue;
      candidates.push({ ...agg, confidence, obsIds: obsIdsFor(facetsByObs, def.facetKind, agg.value) });
    }
    // within-definition order: supportCount desc, bestConfRank desc, value asc
    candidates.sort((a, b) =>
      b.supportCount - a.supportCount || b.bestConfRank - a.bestConfRank || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
    );
    for (const c of candidates.slice(0, def.maxInstances)) {
      const subject = def.subjectFor(c.value);
      const params = def.paramsFor(c.value);
      const semanticKey = snapshotSemanticKey({
        definitionKey: def.definitionKey,
        definitionVersion: DEFINITION_VERSION,
        subject,
        canonicalParams: params,
        canonicalizationVersion: CANONICALIZATION_VERSION,
      });
      const versionId = statementVersionId({
        semanticKey,
        corpusRevision: input.corpusRevision,
        understandingContextRevision: input.understandingContextRevision,
        generationProfileVersion: GENERATION_PROFILE_VERSION,
        scopeFingerprint: sfp,
        confidence: c.confidence,
      });
      const statement: SnapshotStatement = {
        semanticKey,
        versionId,
        definitionKey: def.definitionKey,
        definitionVersion: DEFINITION_VERSION,
        subject,
        params,
        scope: input.scope,
        confidence: c.confidence,
        provenanceKind: 'observed',
        observationIds: [...c.obsIds].sort(), // provenance; not part of any id
        uncertainty: [],
      };
      selected.push({
        statement,
        slot: def.slot,
        supportCount: c.supportCount,
        descRank: DESC_RANK[c.confidence],
        primary: def.primaryParamKey ? String(params[def.primaryParamKey]) : '',
      });
    }
  }

  // final observedStatements order: slot asc, supportCount desc, descRank desc, primary asc, semanticKey asc
  selected.sort((a, b) =>
    a.slot - b.slot ||
    b.supportCount - a.supportCount ||
    b.descRank - a.descRank ||
    (a.primary < b.primary ? -1 : a.primary > b.primary ? 1 : 0) ||
    (a.statement.semanticKey < b.statement.semanticKey ? -1 : a.statement.semanticKey > b.statement.semanticKey ? 1 : 0),
  );
  return selected.map((s) => s.statement);
}

function groupObservations(facets: readonly Facet[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const f of facets) {
    const key = `${f.kind}::${f.value}`;
    let s = m.get(key);
    if (!s) {
      s = new Set();
      m.set(key, s);
    }
    s.add(f.observationId);
  }
  return m;
}
function obsIdsFor(byKey: Map<string, Set<string>>, kind: FacetKind, value: string): string[] {
  return [...(byKey.get(`${kind}::${value}`) ?? new Set<string>())];
}

/** Build the immutable BusinessSnapshotVersion (frozen snapshotId). declaredContext is [] in Commit 4. */
export function buildBusinessSnapshotVersion(input: {
  businessRef: SubjectRef;
  corpusRevision: CorpusRevisionId;
  understandingContextRevision: DeclarationRevisionId;
  observedStatements: readonly SnapshotStatement[];
  declaredContext: readonly DeclaredContextView[];
  createdAt: Timestamp;
  supersedes?: string;
}): BusinessSnapshotVersion {
  const id = businessSnapshotVersionId({
    businessRef: input.businessRef,
    corpusRevision: input.corpusRevision,
    understandingContextRevision: input.understandingContextRevision,
    generationProfileVersion: GENERATION_PROFILE_VERSION,
    observedStatementVersionIds: input.observedStatements.map((s) => s.versionId),
    declaredContextDeclarationIds: input.declaredContext.map((d) => d.declarationId),
  });
  return {
    id,
    businessRef: input.businessRef,
    corpusRevision: input.corpusRevision,
    understandingContextRevision: input.understandingContextRevision,
    observedStatements: input.observedStatements,
    declaredContext: input.declaredContext,
    createdAt: input.createdAt,
    ...(input.supersedes !== undefined ? { supersedes: input.supersedes } : {}),
  };
}
