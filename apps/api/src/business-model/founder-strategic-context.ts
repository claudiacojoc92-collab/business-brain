/**
 * Wave 4 — Founder Strategic Context domain (slice 1). ONE governed aggregate: the explicit, inspectable,
 * temporal, revisable conditions under which the founder's strategy must work. Founder-declared/confirmed only
 * (the model never persists here). Append-only versions; exactly one effective version per logical item. Five
 * kinds, each with discriminated, validated metadata. NOT identity, NOT psychology, NOT a personality profile.
 * Governed by docs/governance/founder-strategic-context-contract.md.
 */

// ── Kinds, source, status ──────────────────────────────────────────────────────────────────────────────
export type StrategicContextKind = 'GOAL' | 'CONSTRAINT' | 'RESOURCE' | 'STRATEGIC_PREFERENCE' | 'DECISION_HORIZON';
export const STRATEGIC_CONTEXT_KINDS: ReadonlySet<string> = new Set(['GOAL', 'CONSTRAINT', 'RESOURCE', 'STRATEGIC_PREFERENCE', 'DECISION_HORIZON']);

export type ContextSource = 'FOUNDER_DECLARED' | 'FOUNDER_CONFIRMED' | 'IMPORTED_ACCEPTED' | 'VERIFIED_SYSTEM_RECORD';
export const CONTEXT_SOURCES: ReadonlySet<string> = new Set(['FOUNDER_DECLARED', 'FOUNDER_CONFIRMED', 'IMPORTED_ACCEPTED', 'VERIFIED_SYSTEM_RECORD']);

export type ContextStatus = 'ACTIVE' | 'RETIRED' | 'SUPERSEDED';

/** Scope — which strategic surface an item applies to. GLOBAL applies to every job. */
export type ContextScope = 'GLOBAL_STRATEGY' | 'CURRENT_PRIORITY' | 'MARKETING' | 'OFFER' | 'ACQUISITION' | 'POSITIONING' | 'WEBSITE' | 'LAUNCH' | 'OTHER';
export const CONTEXT_SCOPES: ReadonlySet<string> = new Set(['GLOBAL_STRATEGY', 'CURRENT_PRIORITY', 'MARKETING', 'OFFER', 'ACQUISITION', 'POSITIONING', 'WEBSITE', 'LAUNCH', 'OTHER']);

// ── Discriminated per-kind metadata ──────────────────────────────────────────────────────────────────────
export type GoalPriority = 'PRIMARY' | 'SECONDARY' | 'UNRANKED';
/** A structured, founder-declared quantitative requirement (for deterministic budget/time conflict detection). */
export interface QuantityRequirement { category: 'BUDGET' | 'TIME'; value: number; unit?: string; period?: string }
/** A structured, founder-declared prerequisite that must complete before the goal can (for HORIZON_FEASIBILITY). */
export interface GoalPrerequisite { description: string; durationDays?: number; completionDate?: string }
export interface GoalMetadata {
  kind: 'GOAL';
  target?: { value: number | string; unit?: string };   // NOT required to be numeric
  horizon?: { label?: string; startsAt?: string; endsAt?: string; triggeringEvent?: string };
  priority: GoalPriority;
  // Optional, founder-declared, explicit-only structured requirements (never inferred):
  requiresResourceCategories?: string[];                 // resource categories the goal explicitly needs
  requires?: QuantityRequirement[];                      // known required budget/time for this goal
  prerequisite?: GoalPrerequisite;                       // a prerequisite whose timeline may not fit a decision horizon
}

export type ConstraintCategory = 'BUDGET' | 'TIME' | 'TEAM' | 'SKILL' | 'GEOGRAPHY' | 'LEGAL' | 'CONTRACTUAL' | 'CAPACITY' | 'RUNWAY' | 'SEASONALITY' | 'OTHER';
export type FounderClassification = 'NON_NEGOTIABLE' | 'NEGOTIABLE' | 'NOT_YET_CLASSIFIED';
export type TemporaryOrStructural = 'TEMPORARY' | 'STRUCTURAL' | 'UNKNOWN';
export interface ConstraintMetadata {
  kind: 'CONSTRAINT';
  category: ConstraintCategory;
  founderClassification: FounderClassification; // NON_NEGOTIABLE only from an explicit founder write
  temporaryOrStructural: TemporaryOrStructural;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
  limit?: { value: number; unit?: string; period?: string }; // explicit max available (e.g. £150/month, 4h/week)
}

export type ResourceCategory = 'BUDGET' | 'TIME' | 'TEAM' | 'AUDIENCE' | 'SKILL' | 'CONTENT_ASSET' | 'PARTNERSHIP' | 'DISTRIBUTION' | 'REPUTATION' | 'TECHNOLOGY' | 'OTHER';
// UNAVAILABLE is founder-explicit — it is NEVER inferred from absence, UNKNOWN, or a non-declared zero.
export type ResourceAvailability = 'AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'PLANNED' | 'UNAVAILABLE' | 'UNKNOWN';
export type ResourceEvidenceStatus = 'FOUNDER_DECLARED' | 'VERIFIED' | 'NOT_VERIFIED';
export interface ResourceMetadata {
  kind: 'RESOURCE';
  category: ResourceCategory;
  quantity?: number | string;
  unit?: string;
  availability: ResourceAvailability;
  evidenceStatus: ResourceEvidenceStatus; // a qualitative claim is FOUNDER_DECLARED, never silently VERIFIED
}

export type PreferenceCategory = 'ACQUISITION' | 'BRAND' | 'PRICING' | 'DELIVERY' | 'GROWTH_PACE' | 'VISIBILITY' | 'FUNDING' | 'TEAM' | 'MARKET' | 'BUSINESS_MODEL' | 'OTHER';
export type PreferenceStrength = 'PREFERENCE' | 'STRONG_PREFERENCE' | 'NON_NEGOTIABLE';
export interface StrategicPreferenceMetadata {
  kind: 'STRATEGIC_PREFERENCE';
  category: PreferenceCategory;
  strength: PreferenceStrength; // NON_NEGOTIABLE only from an explicit founder write
  rationale?: string;
}

export type HorizonAppliesTo = 'GLOBAL_STRATEGY' | 'CURRENT_PRIORITY' | 'MARKETING' | 'OFFER' | 'ACQUISITION' | 'POSITIONING' | 'WEBSITE' | 'LAUNCH' | 'OTHER';
export interface DecisionHorizonMetadata {
  kind: 'DECISION_HORIZON';
  label: string;
  startsAt?: string;
  endsAt?: string;
  triggeringEvent?: string;
  appliesTo: HorizonAppliesTo;
}

export type ContextMetadata = GoalMetadata | ConstraintMetadata | ResourceMetadata | StrategicPreferenceMetadata | DecisionHorizonMetadata;

// ── The aggregate ────────────────────────────────────────────────────────────────────────────────────────
export interface FounderStrategicContextItem {
  id: string;
  founderId: string;
  logicalItemId: string;          // stable identity across revisions
  version: number;
  kind: StrategicContextKind;
  statement: string;
  category: string;               // founder-legible sub-category (mirrors metadata.category where present)
  scope: ContextScope;
  source: ContextSource;
  status: ContextStatus;                 // DERIVED from version ordering + lifecycle (never a mutated column)
  lifecycle: 'CREATE' | 'REVISE' | 'RETIRE'; // immutable per-version marker
  effectiveFrom: string;
  effectiveUntil: string | null;
  reviewAt: string | null;
  metadata: ContextMetadata;
  supersedesItemId: string | null;
  createdAt: string;
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────────────────
/** Domain error → the route maps it to a founder-safe 400 (never a raw DB/model error). */
export class ContextValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ContextValidationError'; }
}

const s = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const inSet = (set: ReadonlySet<string>, v: unknown): boolean => typeof v === 'string' && set.has(v);
const isoOrNull = (v: unknown, field: string): string | null => {
  if (v == null || v === '') return null;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) throw new ContextValidationError(`${field} is not a valid date`);
  return d.toISOString();
};

const CONSTRAINT_CATS = new Set(['BUDGET', 'TIME', 'TEAM', 'SKILL', 'GEOGRAPHY', 'LEGAL', 'CONTRACTUAL', 'CAPACITY', 'RUNWAY', 'SEASONALITY', 'OTHER']);
const RESOURCE_CATS = new Set(['BUDGET', 'TIME', 'TEAM', 'AUDIENCE', 'SKILL', 'CONTENT_ASSET', 'PARTNERSHIP', 'DISTRIBUTION', 'REPUTATION', 'TECHNOLOGY', 'OTHER']);
const PREF_CATS = new Set(['ACQUISITION', 'BRAND', 'PRICING', 'DELIVERY', 'GROWTH_PACE', 'VISIBILITY', 'FUNDING', 'TEAM', 'MARKET', 'BUSINESS_MODEL', 'OTHER']);
const GOAL_PRIORITIES = new Set(['PRIMARY', 'SECONDARY', 'UNRANKED']);
const FOUNDER_CLASS = new Set(['NON_NEGOTIABLE', 'NEGOTIABLE', 'NOT_YET_CLASSIFIED']);
const TEMP_STRUCT = new Set(['TEMPORARY', 'STRUCTURAL', 'UNKNOWN']);
const SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);
const RESOURCE_AVAIL = new Set(['AVAILABLE', 'PARTIALLY_AVAILABLE', 'PLANNED', 'UNAVAILABLE', 'UNKNOWN']);
const QTY_CATS = new Set(['BUDGET', 'TIME']);
/** Parse a founder-declared quantity requirement/limit; null unless value is an explicit finite number. */
function quantity(v: unknown): { value: number; unit?: string; period?: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o['value'] !== 'number' || !Number.isFinite(o['value'])) return null;
  return { value: o['value'] as number, ...(o['unit'] ? { unit: s(o['unit'], 40) } : {}), ...(o['period'] ? { period: s(o['period'], 40) } : {}) };
}
const RESOURCE_EVIDENCE = new Set(['FOUNDER_DECLARED', 'VERIFIED', 'NOT_VERIFIED']);
const PREF_STRENGTHS = new Set(['PREFERENCE', 'STRONG_PREFERENCE', 'NON_NEGOTIABLE']);

function normalizeMetadata(kind: StrategicContextKind, raw: unknown): ContextMetadata {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (kind) {
    case 'GOAL': {
      const priority = inSet(GOAL_PRIORITIES, m['priority']) ? (m['priority'] as GoalPriority) : 'UNRANKED';
      const out: GoalMetadata = { kind: 'GOAL', priority };
      const t = m['target'] as Record<string, unknown> | undefined;
      if (t && (typeof t['value'] === 'number' || (typeof t['value'] === 'string' && s(t['value']).length > 0))) {
        out.target = { value: typeof t['value'] === 'number' ? (t['value'] as number) : s(t['value'], 120), ...(t['unit'] ? { unit: s(t['unit'], 40) } : {}) };
      }
      const h = m['horizon'] as Record<string, unknown> | undefined;
      if (h && typeof h === 'object') out.horizon = { ...(h['label'] ? { label: s(h['label'], 120) } : {}), ...(h['startsAt'] != null ? { startsAt: isoOrNull(h['startsAt'], 'horizon.startsAt')! } : {}), ...(h['endsAt'] != null ? { endsAt: isoOrNull(h['endsAt'], 'horizon.endsAt')! } : {}), ...(h['triggeringEvent'] ? { triggeringEvent: s(h['triggeringEvent'], 200) } : {}) };
      // Explicit-only structured requirements (never inferred). Invalid entries are dropped, not guessed.
      const rrc = Array.isArray(m['requiresResourceCategories']) ? (m['requiresResourceCategories'] as unknown[]).map((x) => String(x)).filter((x) => RESOURCE_CATS.has(x)) : [];
      if (rrc.length) out.requiresResourceCategories = [...new Set(rrc)].slice(0, 10);
      const reqs = Array.isArray(m['requires']) ? (m['requires'] as unknown[]).map((r) => { const ro = (r ?? {}) as Record<string, unknown>; const cat = String(ro['category']); const q = quantity(ro); return q && QTY_CATS.has(cat) ? { category: cat as 'BUDGET' | 'TIME', ...q } : null; }).filter((x): x is NonNullable<typeof x> => x != null) : [];
      if (reqs.length) out.requires = reqs.slice(0, 6);
      const pre = m['prerequisite'] as Record<string, unknown> | undefined;
      if (pre && typeof pre === 'object' && s(pre['description'])) {
        out.prerequisite = { description: s(pre['description'], 300),
          ...(typeof pre['durationDays'] === 'number' && Number.isFinite(pre['durationDays']) ? { durationDays: pre['durationDays'] as number } : {}),
          ...(pre['completionDate'] != null ? { completionDate: isoOrNull(pre['completionDate'], 'prerequisite.completionDate')! } : {}) };
      }
      return out;
    }
    case 'CONSTRAINT': {
      if (!inSet(CONSTRAINT_CATS, m['category'])) throw new ContextValidationError('constraint category is required and must be a supported value');
      const founderClassification = inSet(FOUNDER_CLASS, m['founderClassification']) ? (m['founderClassification'] as FounderClassification) : 'NOT_YET_CLASSIFIED';
      const out: ConstraintMetadata = {
        kind: 'CONSTRAINT', category: m['category'] as ConstraintCategory, founderClassification,
        temporaryOrStructural: inSet(TEMP_STRUCT, m['temporaryOrStructural']) ? (m['temporaryOrStructural'] as TemporaryOrStructural) : 'UNKNOWN',
      };
      if (inSet(SEVERITIES, m['severity'])) out.severity = m['severity'] as 'LOW' | 'MEDIUM' | 'HIGH';
      const lim = quantity(m['limit']);                    // explicit max available (for quantitative conflict)
      if (lim) out.limit = lim;
      return out;
    }
    case 'RESOURCE': {
      if (!inSet(RESOURCE_CATS, m['category'])) throw new ContextValidationError('resource category is required and must be a supported value');
      // A qualitative founder claim is FOUNDER_DECLARED, never silently VERIFIED (rule: unknown/declared ≠ verified quantity).
      const evidenceStatus = inSet(RESOURCE_EVIDENCE, m['evidenceStatus']) ? (m['evidenceStatus'] as ResourceEvidenceStatus) : 'FOUNDER_DECLARED';
      const out: ResourceMetadata = {
        kind: 'RESOURCE', category: m['category'] as ResourceCategory,
        availability: inSet(RESOURCE_AVAIL, m['availability']) ? (m['availability'] as ResourceAvailability) : 'UNKNOWN',
        evidenceStatus: evidenceStatus === 'VERIFIED' ? 'FOUNDER_DECLARED' : evidenceStatus, // never accept VERIFIED from a founder-declared write
      };
      if (typeof m['quantity'] === 'number') out.quantity = m['quantity'] as number;
      else if (typeof m['quantity'] === 'string' && s(m['quantity']).length > 0) out.quantity = s(m['quantity'], 120);
      if (m['unit']) out.unit = s(m['unit'], 40);
      return out;
    }
    case 'STRATEGIC_PREFERENCE': {
      if (!inSet(PREF_CATS, m['category'])) throw new ContextValidationError('preference category is required and must be a supported value');
      const out: StrategicPreferenceMetadata = {
        kind: 'STRATEGIC_PREFERENCE', category: m['category'] as PreferenceCategory,
        strength: inSet(PREF_STRENGTHS, m['strength']) ? (m['strength'] as PreferenceStrength) : 'PREFERENCE',
      };
      if (m['rationale']) out.rationale = s(m['rationale'], 500);
      return out;
    }
    case 'DECISION_HORIZON': {
      const label = s(m['label'], 120);
      if (!label) throw new ContextValidationError('decision horizon requires a label');
      const out: DecisionHorizonMetadata = {
        kind: 'DECISION_HORIZON', label,
        appliesTo: inSet(CONTEXT_SCOPES, m['appliesTo']) ? (m['appliesTo'] as HorizonAppliesTo) : 'CURRENT_PRIORITY',
      };
      if (m['startsAt'] != null) out.startsAt = isoOrNull(m['startsAt'], 'startsAt')!;
      if (m['endsAt'] != null) out.endsAt = isoOrNull(m['endsAt'], 'endsAt')!;
      if (m['triggeringEvent']) out.triggeringEvent = s(m['triggeringEvent'], 200);
      return out;
    }
  }
}

export interface ContextItemInput {
  kind: string; statement: string; scope?: string; source?: string;
  effectiveFrom?: string; effectiveUntil?: string | null; reviewAt?: string | null;
  metadata?: unknown;
}

/** Validate + normalize a create/revise input into the durable fields (minus id/version/status — the repo owns those). */
export function normalizeContextItemInput(input: ContextItemInput, now: Date): {
  kind: StrategicContextKind; statement: string; category: string; scope: ContextScope; source: ContextSource;
  effectiveFrom: string; effectiveUntil: string | null; reviewAt: string | null; metadata: ContextMetadata;
} {
  if (!inSet(STRATEGIC_CONTEXT_KINDS, input.kind)) throw new ContextValidationError('a supported context kind is required');
  const kind = input.kind as StrategicContextKind;
  const statement = s(input.statement, 1000);
  if (!statement) throw new ContextValidationError('a statement is required');
  const scope = inSet(CONTEXT_SCOPES, input.scope) ? (input.scope as ContextScope) : 'GLOBAL_STRATEGY';
  // Every write here is an explicit founder action → FOUNDER_DECLARED/CONFIRMED/IMPORTED_ACCEPTED. Never model-invented.
  const source = inSet(CONTEXT_SOURCES, input.source) ? (input.source as ContextSource) : 'FOUNDER_DECLARED';
  if (source === 'VERIFIED_SYSTEM_RECORD') throw new ContextValidationError('VERIFIED_SYSTEM_RECORD is not a founder-declarable source in this slice');
  const effectiveFrom = isoOrNull(input.effectiveFrom, 'effectiveFrom') ?? now.toISOString();
  const effectiveUntil = isoOrNull(input.effectiveUntil, 'effectiveUntil');
  const reviewAt = isoOrNull(input.reviewAt, 'reviewAt');
  if (effectiveUntil && effectiveUntil < effectiveFrom) throw new ContextValidationError('effectiveUntil cannot be before effectiveFrom');
  if (reviewAt && reviewAt < effectiveFrom) throw new ContextValidationError('reviewAt cannot be before effectiveFrom');
  const metadata = normalizeMetadata(kind, input.metadata);
  const category = 'category' in metadata ? (metadata as { category: string }).category : kind;
  return { kind, statement, category, scope, source, effectiveFrom, effectiveUntil, reviewAt, metadata };
}

/** True when the item declares a founder-set non-negotiable (constraint classification or preference strength). */
export function isNonNegotiable(item: Pick<FounderStrategicContextItem, 'metadata'>): boolean {
  const m = item.metadata;
  return (m.kind === 'CONSTRAINT' && m.founderClassification === 'NON_NEGOTIABLE') || (m.kind === 'STRATEGIC_PREFERENCE' && m.strength === 'NON_NEGOTIABLE');
}
