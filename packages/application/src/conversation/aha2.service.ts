import { createHash } from 'node:crypto';
import { generateId } from '@bb/shared';
import type { IUnderstandingSnapshotRepository, GovernedUnderstanding } from '../bi/index';
import type {
  IFounderStateRepository,
  IFounderObservationRepository,
  IConversationRepository,
  IAha2ModelPort,
  IAha2Repository,
  Aha2Record,
  Aha2Finding,
  Aha2FindingResolved,
  Aha2Output,
} from './contracts';
import { classifyAha2Finding, assertAha2WellFormed, type Aha2Refs, type Aha2Rejection } from './validation';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Flatten governed understanding into labelled business elements (B1..) the synthesis can cite. */
function toBusinessElements(u: GovernedUnderstanding | null): { ref: string; text: string }[] {
  if (!u) return [];
  const raw: string[] = [];
  if (u.offer?.summary) raw.push(`Offer: ${u.offer.summary}`);
  if (u.positioning?.summary) raw.push(`Positioning: ${u.positioning.summary}`);
  if (u.audience?.addressed?.length) raw.push(`Audience addressed: ${u.audience.addressed.join('; ')}`);
  if (u.acquisition?.visiblePaths?.length) raw.push(`Conversion paths on the site: ${u.acquisition.visiblePaths.join('; ')}`);
  for (const c of u.contradictions ?? []) raw.push(`Tension: ${c.tension}`);
  return raw.slice(0, 10).map((text, i) => ({ ref: `B${i + 1}`, text }));
}

/** Observability event for the repair loop (used for reliability reporting; never founder-facing). */
export type Aha2Event =
  | { type: 'first_pass_ok' }
  | { type: 'repair_attempt'; reason: Aha2Rejection; attempt: number }
  | { type: 'repaired_ok'; attempts: number }
  | { type: 'failed_closed'; reason: Aha2Rejection };

export interface Aha2Deps {
  understanding: IUnderstandingSnapshotRepository;
  state: IFounderStateRepository;
  observations: IFounderObservationRepository;
  conversations: IConversationRepository;
  model: IAha2ModelPort;
  aha2: IAha2Repository;
  log?: (e: Aha2Event) => void;
}

/** Reasons worth a scoped repair (the cross-source insight is real, only the phrasing broke a gate). */
const REPAIRABLE: ReadonlySet<Aha2Rejection> = new Set<Aha2Rejection>([
  'strategy_selection', 'unsupported_outcome', 'founder_state_upgrade', 'unlicensed_claim',
]);
const REASON_TEXT: Record<Aha2Rejection, string> = {
  strategy_selection: 'It chose a strategy (a channel / tactic / bet / optimization) instead of naming a constraint or tension.',
  unsupported_outcome: 'It predicted an outcome (leads / clients / sales) that the evidence does not license.',
  founder_state_upgrade: 'It upgraded a founder-state type into a stronger claim — e.g. a preference into a target segment, or a constraint into a market-effectiveness judgment.',
  unlicensed_claim: 'It made a market / competitive / trust / conversion claim the evidence does not license.',
  psychology: 'It made a psychological / hidden-motive claim.',
  not_cross_source: 'It did not connect at least one business element with at least one founder-owned element.',
  too_short: 'It was too short to be a real implication.',
};
const MAX_REPAIR_ATTEMPTS = 2;

export class Aha2Service {
  constructor(private readonly deps: Aha2Deps) {}

  async generate(businessId: string, businessName: string, language: string): Promise<Aha2Record> {
    const snap = await this.deps.understanding.latest(businessId);
    const businessElements = toBusinessElements(snap?.understanding ?? null);

    const stateItems = (await this.deps.state.listActive(businessId)).filter((s) => s.kind !== 'business_correction');
    const founderState = stateItems.map((s, i) => ({ ref: `F${i + 1}`, kind: s.kind, statement: s.statement }));
    const obsItems = (await this.deps.observations.listActive(businessId)).filter((o) => o.status === 'supported' || o.status === 'confirmed');
    const observations = obsItems.map((o, i) => ({ ref: `O${i + 1}`, behavior: o.behavior }));

    const session = await this.deps.conversations.getByBusiness(businessId);

    // Cross-source is impossible without BOTH sides → honest insufficient, never a one-sided "Aha".
    if (businessElements.length === 0 || founderState.length === 0) {
      return this.deps.aha2.save({
        id: generateId(), businessId, sessionId: session?.id ?? null,
        understandingSnapshotId: snap?.id ?? null, language,
        contentHash: sha256(`insufficient|${businessId}|${language}`), modelId: 'anthropic',
        status: 'insufficient', findings: [],
      });
    }

    const out = await this.deps.model.synthesize({ businessName, interfaceLanguage: language, businessElements, founderState, observations });
    assertAha2WellFormed(out);

    const refs: Aha2Refs = {
      business: new Set(businessElements.map((e) => e.ref)),
      founder: new Map(founderState.map((e) => [e.ref, e.kind])),
      observation: new Set(observations.map((e) => e.ref)),
    };
    const bElem = new Map(businessElements.map((e) => [e.ref, e]));
    const fElem = new Map(founderState.map((e) => [e.ref, e]));
    const oElem = new Map(observations.map((e) => [e.ref, e]));

    // Per-finding: validate → if a boundary broke but the cross-source insight is real, repair the
    // clause (bounded attempts) preserving the same refs → validate again → persist only if valid.
    // Fail closed (drop) if still invalid: strict gate, but repaired instead of silently discarded.
    const validFindings: Aha2FindingResolved[] = [];
    for (const raw of (out.findings ?? []).slice(0, 5)) {
      let current: Aha2Finding = raw;
      let res = classifyAha2Finding(current, refs);
      let attempts = 0;
      while (!res.ok && REPAIRABLE.has(res.reason) && attempts < MAX_REPAIR_ATTEMPTS) {
        attempts += 1;
        this.deps.log?.({ type: 'repair_attempt', reason: res.reason, attempt: attempts });
        const reason = res.reason;
        let repaired: Aha2Output;
        try {
          repaired = await this.deps.model.repair({
            businessName, interfaceLanguage: language,
            invalidImplication: (current.implication ?? '').trim(),
            failureReason: REASON_TEXT[reason],
            businessElements: (current.businessRefs ?? []).filter((r) => bElem.has(r)).map((r) => bElem.get(r)!),
            founderState: (current.founderRefs ?? []).filter((r) => fElem.has(r)).map((r) => fElem.get(r)!),
            observations: (current.observationRefs ?? []).filter((r) => oElem.has(r)).map((r) => oElem.get(r)!),
          });
        } catch {
          break; // model failure → fall through to fail-closed
        }
        const rf = repaired.findings?.[0];
        if (!rf) break;
        // Keep the original refs if the model dropped them — repair must not lose the cross-source link.
        current = {
          implication: rf.implication,
          businessRefs: rf.businessRefs?.length ? rf.businessRefs : current.businessRefs,
          founderRefs: rf.founderRefs?.length ? rf.founderRefs : current.founderRefs,
          observationRefs: rf.observationRefs?.length ? rf.observationRefs : current.observationRefs,
        };
        res = classifyAha2Finding(current, refs);
      }
      if (res.ok) {
        this.deps.log?.(attempts > 0 ? { type: 'repaired_ok', attempts } : { type: 'first_pass_ok' });
        const f = res.finding;
        validFindings.push({
          implication: f.implication,
          business: f.businessRefs.map((r) => bElem.get(r)?.text).filter((x): x is string => Boolean(x)),
          founder: f.founderRefs.map((r) => fElem.get(r)?.statement).filter((x): x is string => Boolean(x)),
          observations: f.observationRefs.map((r) => oElem.get(r)?.behavior).filter((x): x is string => Boolean(x)),
        });
      } else {
        this.deps.log?.({ type: 'failed_closed', reason: res.reason });
      }
    }

    const findings = validFindings.slice(0, 3);
    const status: 'produced' | 'insufficient' = findings.length > 0 ? 'produced' : 'insufficient';
    return this.deps.aha2.save({
      id: generateId(), businessId, sessionId: session?.id ?? null,
      understandingSnapshotId: snap?.id ?? null, language,
      contentHash: sha256(JSON.stringify(findings) + '|' + language),
      modelId: 'anthropic',
      status, findings,
    });
  }

  latest(businessId: string): Promise<Aha2Record | null> {
    return this.deps.aha2.latest(businessId);
  }
}
