import { createHash } from 'node:crypto';
import { generateId } from '@bb/shared';
import { NotFoundError, ValidationError } from '@bb/shared';
import type { IUnderstandingSnapshotRepository, GovernedUnderstanding, IAhaRepository } from '../bi/index';
import type { IFounderStateRepository, IFounderObservationRepository, IAha2Repository, FounderStateKind } from '../conversation/index';
import type {
  IStrategyModelPort,
  IStrategyRepository,
  IStrategyPointerRepository,
  StrategyBundle,
  StrategyVersionRecord,
  StrategyModelInput,
  StrategyGateResult,
} from './contracts';
import { validateStrategy, type StrategyContextForGate } from './validation';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Flatten governed understanding into labelled business elements (B1..) the strategy can cite. */
function toBusinessElements(u: GovernedUnderstanding | null): { ref: string; text: string }[] {
  if (!u) return [];
  const raw: string[] = [];
  if (u.offer?.summary) raw.push(`Offer: ${u.offer.summary}`);
  if (u.positioning?.summary) raw.push(`Positioning: ${u.positioning.summary}`);
  if (u.audience?.addressed?.length) raw.push(`Audience addressed: ${u.audience.addressed.join('; ')}`);
  if (u.messaging?.recurringThemes?.length) raw.push(`Messaging themes: ${u.messaging.recurringThemes.join('; ')}`);
  if (u.acquisition?.visiblePaths?.length) raw.push(`Conversion paths on the site: ${u.acquisition.visiblePaths.join('; ')}`);
  for (const c of u.contradictions ?? []) raw.push(`Tension: ${c.tension}`);
  for (const x of u.unknowns ?? []) raw.push(`Unknown: ${x}`);
  return raw.slice(0, 12).map((text, i) => ({ ref: `B${i + 1}`, text }));
}

export type StrategyEvent =
  | { type: 'first_pass_ok' }
  | { type: 'repair_attempt'; component: string; gate: string; attempt: number }
  | { type: 'repaired_ok'; attempts: number }
  | { type: 'judge_repair'; dimension: string; attempt: number }
  | { type: 'failed_closed'; gate: string };

export interface StrategyDeps {
  understanding: IUnderstandingSnapshotRepository;
  state: IFounderStateRepository;
  observations: IFounderObservationRepository;
  aha1: IAhaRepository;
  aha2: IAha2Repository;
  model: IStrategyModelPort;
  strategy: IStrategyRepository;
  pointer: IStrategyPointerRepository;
  log?: (e: StrategyEvent) => void;
}

const MAX_STRUCT_REPAIRS = 4;
const MAX_JUDGE_REPAIRS = 2;

export class StrategyService {
  constructor(private readonly deps: StrategyDeps) {}

  private async loadInput(businessId: string, businessName: string, language: string): Promise<{
    input: StrategyModelInput; ctx: StrategyContextForGate; hasGoal: boolean; snapId: string | null;
  }> {
    const snap = await this.deps.understanding.latest(businessId);
    const businessElements = toBusinessElements(snap?.understanding ?? null);
    // Founder-OWNED state (preferences/goals) stays distinct from founder business-fact CORRECTIONS. Only
    // active rows are read, so a superseded correction is never injected as current truth (M3.5).
    const allActive = await this.deps.state.listActive(businessId);
    const stateItems = allActive.filter((s) => s.kind !== 'business_correction');
    const founderState = stateItems.map((s, i) => ({ ref: `F${i + 1}`, kind: s.kind, statement: s.statement }));
    const businessCorrections = allActive
      .filter((s) => s.kind === 'business_correction')
      .map((s, i) => ({ ref: `C${i + 1}`, subject: s.scope ?? '', statement: s.statement }));
    const obs = (await this.deps.observations.listActive(businessId)).filter((o) => o.status === 'supported' || o.status === 'confirmed');
    const observations = obs.map((o, i) => ({ ref: `O${i + 1}`, behavior: o.behavior }));
    const aha1rec = await this.deps.aha1.latest(businessId);
    const aha1 = (aha1rec?.findings ?? []).map((f) => ({ finding: f.finding }));
    const aha2rec = await this.deps.aha2.latest(businessId);
    const aha2 = aha2rec?.status === 'produced' ? aha2rec.findings.map((f) => ({ implication: f.implication })) : [];
    const input: StrategyModelInput = { businessName, interfaceLanguage: language, businessElements, founderState, observations, aha1, aha2, businessCorrections };
    // Corrections join the gate's BUSINESS context (authoritative world-facts), so a decision grounded in a
    // correction resolves its ref and contributes anti-transplant anchors — they are NOT founder-state, so the
    // founder-state compatibility / hard-constraint gates are unchanged.
    const correctionElements = businessCorrections.map((c) => ({ ref: c.ref, text: `Founder-corrected (${c.subject || 'business'}): ${c.statement}` }));
    const ctx: StrategyContextForGate = { business: [...businessElements, ...correctionElements], founder: founderState, observation: observations };
    return { input, ctx, hasGoal: founderState.some((f) => f.kind === 'goal'), snapId: snap?.id ?? null };
  }

  async generate(businessId: string, businessName: string, language: string): Promise<StrategyVersionRecord> {
    const { input, ctx, hasGoal } = await this.loadInput(businessId, businessName, language);

    // A goal-relative strategy needs a governed business + a founder goal. Honest insufficient otherwise.
    if (input.businessElements.length === 0 || !hasGoal) {
      return this.persist(businessId, emptyBundle(input, language), 'insufficient',
        [{ gate: 'inputs_sufficient', pass: false, detail: input.businessElements.length === 0 ? 'No governed business understanding.' : 'No founder goal captured yet.' }],
        input, language);
    }

    let bundle: StrategyBundle;
    try {
      const out = await this.deps.model.generate(input);
      bundle = out.strategy;
    } catch {
      // Malformed / failed generation → honest insufficient, never a 500 or a half-strategy.
      this.deps.log?.({ type: 'failed_closed', gate: 'model_generate' });
      return this.persist(businessId, emptyBundle(input, language), 'insufficient', [{ gate: 'model_generate', pass: false, detail: 'The strategy generator returned an unusable response.' }], input, language);
    }

    // ── deterministic repair loop: repair ONLY the failed component, bounded, fail closed ──
    let v = validateStrategy(bundle, ctx);
    let attempts = 0;
    while (!v.pass && attempts < MAX_STRUCT_REPAIRS) {
      attempts += 1;
      const f = v.failures[0]!;
      this.deps.log?.({ type: 'repair_attempt', component: f.component, gate: f.gate, attempt: attempts });
      try {
        const r = await this.deps.model.repair({ ...input, current: bundle, failedComponent: f.component, failureReason: `${f.gate}: ${f.detail}` });
        bundle = r.strategy;
      } catch { break; }
      v = validateStrategy(bundle, ctx);
    }
    if (!v.pass) {
      this.deps.log?.({ type: 'failed_closed', gate: v.failures[0]?.gate ?? 'unknown' });
      return this.persist(businessId, bundle, 'insufficient', v.gateResults, input, language);
    }

    // ── judged layer: grounding / genericity nuance / coherence / fit; repair failed dimensions ──
    let gateResults: StrategyGateResult[] = v.gateResults;
    let judgeAttempts = 0;
    try {
      let judged = await this.deps.model.judge({ ...input, strategy: bundle });
      while (judged.verdicts.some((jv) => !jv.pass) && judgeAttempts < MAX_JUDGE_REPAIRS) {
        judgeAttempts += 1;
        const bad = judged.verdicts.find((jv) => !jv.pass)!;
        this.deps.log?.({ type: 'judge_repair', dimension: bad.dimension, attempt: judgeAttempts });
        try {
          const r = await this.deps.model.repair({ ...input, current: bundle, failedComponent: bad.component, failureReason: `${bad.dimension}: ${bad.reason}` });
          bundle = r.strategy;
        } catch { break; }
        const rv = validateStrategy(bundle, ctx); // repair must not break deterministic gates
        if (!rv.pass) { this.deps.log?.({ type: 'failed_closed', gate: rv.failures[0]?.gate ?? 'judge_repair_broke_structure' }); return this.persist(businessId, bundle, 'insufficient', rv.gateResults, input, language); }
        gateResults = rv.gateResults;
        judged = await this.deps.model.judge({ ...input, strategy: bundle });
      }
      gateResults = [...gateResults, ...judged.verdicts.map((jv) => ({ gate: `judge:${jv.dimension}`, pass: jv.pass, detail: jv.pass ? 'ok' : jv.reason }))];
      if (judged.verdicts.some((jv) => !jv.pass)) {
        this.deps.log?.({ type: 'failed_closed', gate: `judge:${judged.verdicts.find((jv) => !jv.pass)!.dimension}` });
        return this.persist(businessId, bundle, 'insufficient', gateResults, input, language);
      }
    } catch {
      // judge unavailable → deterministic pass stands (do not fail an otherwise-valid proposal).
    }

    this.deps.log?.(attempts > 0 ? { type: 'repaired_ok', attempts } : { type: 'first_pass_ok' });
    return this.persist(businessId, bundle, 'proposal', gateResults, input, language);
  }

  private async persist(businessId: string, bundle: StrategyBundle, status: 'proposal' | 'insufficient', gateResults: StrategyGateResult[], input: StrategyModelInput, language: string): Promise<StrategyVersionRecord> {
    const version = await this.deps.strategy.nextVersion(businessId);
    return this.deps.strategy.save({
      id: generateId(), businessId, version, status, bundle, gateResults,
      contextHash: sha256(JSON.stringify({ b: input.businessElements, f: input.founderState, o: input.observations, c: input.businessCorrections })),
      modelId: 'anthropic', language,
    });
  }

  /** Explicit founder adoption: only a Proposal can become Current. Passing gates alone never adopts. */
  async adopt(businessId: string, versionId: string, founderId: string): Promise<StrategyVersionRecord> {
    const v = await this.deps.strategy.getById(businessId, versionId);
    if (!v) throw new NotFoundError('STRATEGY_NOT_FOUND', 'Strategy version not found.');
    if (v.status !== 'proposal') throw new ValidationError('NOT_ADOPTABLE', 'Only a strategy Proposal can be adopted.');
    await this.deps.pointer.setCurrent(businessId, versionId, founderId);
    return v;
  }

  /** The adopted Current strategy — reopened as-is, never regenerated. */
  async getCurrent(businessId: string): Promise<{ record: StrategyVersionRecord; adoptedAt: string | null } | null> {
    const ptr = await this.deps.pointer.get(businessId);
    if (!ptr?.currentVersionId) return null;
    const rec = await this.deps.strategy.getById(businessId, ptr.currentVersionId);
    return rec ? { record: rec, adoptedAt: ptr.adoptedAt } : null;
  }

  getProposal(businessId: string): Promise<StrategyVersionRecord | null> {
    return this.deps.strategy.latestProposal(businessId);
  }

  /**
   * Founder correction/challenge (section 23): capture the founder-owned input (constraint / preference /
   * decision), or a world-fact correction as a business_correction (NOT a strategy preference), then
   * regenerate a fresh Proposal. World-fact corrections are kept separate from strategy preferences.
   */
  async recordFounderInput(businessId: string, founderId: string, businessName: string, kind: FounderStateKind, statement: string, language: string): Promise<StrategyVersionRecord> {
    await this.deps.state.append({ id: generateId(), businessId, founderId, kind, statement, scope: null, language, sourceTurnId: null });
    return this.generate(businessId, businessName, language);
  }
}

function emptyBundle(input: StrategyModelInput, language: string): StrategyBundle {
  return {
    core: {
      goal: input.founderState.find((f) => f.kind === 'goal')?.statement ?? '', horizon: '', diagnosis: '',
      coreBet: { priority: '', deprioritized: '', whyOverAlternative: '', relationToGoal: '', relationToBottleneck: '', founderFit: '', resourceFit: '' },
      offerDirection: '', positioningDirection: '', audiencePrimaryForGoal: '', audienceRoles: [],
      founderConstraints: [], resourceEnvelope: [], assumptions: [], tradeOffs: [], notNow: [], reconsiderTriggers: [],
    },
    branch: { market: '', language, messagingDirection: '', channelPriorities: [], acquisitionApproach: '', contentRole: '', ctaDirection: '' },
    decisions: [],
  };
}
