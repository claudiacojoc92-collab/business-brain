import { createHash } from 'node:crypto';
import { isHeldGoal } from '../conversation/goal-candidate';
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
  StrategyUnderstandingRead,
} from './contracts';
import { validateStrategy, omitUnsupportedSecondary, type StrategyContextForGate, type StrategyValidation } from './validation';
import { addCapacityPrerequisite, resolveJudgeFailures } from './judge-fallback';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Flatten governed understanding into labelled business elements (B1..) the strategy can cite. */
export function toBusinessElements(u: GovernedUnderstanding | null): { ref: string; text: string }[] {
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
  | { type: 'repair_result'; attempt: number; failures: string[] }
  | { type: 'judge_round'; round: number; verdicts: { dimension: string; pass: boolean; component: string; reason: string }[] }
  | { type: 'judge_repair'; dimension: string; component: string; attempt: number }
  | { type: 'judge_repair_result'; attempt: number; gatesPass: boolean }
  | { type: 'capacity_prerequisite'; added: string }
  | { type: 'judge_fallback'; resolved: { dimension: string; how: string }[] }
  | { type: 'secondary_omitted'; omitted: string[] }
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
/** The founder-facing core that the secondary fallback never omits: repaired first. */
const CENTRAL = ['diagnosis', 'coreBet', 'offerDirection', 'positioningDirection'];
const centralRank = (c: string): number => (CENTRAL.includes(c) ? CENTRAL.indexOf(c) : CENTRAL.length);
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
    // A goal row the classifier filed that is not an OUTCOME (a milestone or a condition) goes in as an intention, so
    // the strategy never builds on it as the goal (2026-10-12); no held goal ⇒ the assumed-goal path flags it.
    const founderState = stateItems.map((s, i) => ({ ref: `F${i + 1}`, kind: s.kind === 'goal' && !isHeldGoal(s) ? 'intention' as const : s.kind, statement: s.statement }));
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

  /**
   * `opts.assumedGoal` (the named constraint) is used ONLY when no founder goal is held — the founder reached the
   * conversation cap without stating one (operator, 2026-10-12). It joins the founder state as an explicitly assumed
   * goal and is recorded on the bundle (core.assumedGoal) so the card flags it. A held goal always wins.
   */
  async generate(businessId: string, businessName: string, language: string, opts: { assumedGoal?: string | null; observedResults?: readonly string[]; understandingRead?: StrategyUnderstandingRead | null } = {}): Promise<StrategyVersionRecord> {
    const loaded = await this.loadInput(businessId, businessName, language);
    const { ctx } = loaded;
    // Observed results (Result Loop) join as their own R-refs: citable business evidence for the gates, never founder state.
    const results = (opts.observedResults ?? []).map((s) => s.trim()).filter(Boolean).map((statement, i) => ({ ref: `R${i + 1}`, statement }));
    const withResults: StrategyModelInput = results.length ? { ...loaded.input, observedResults: results } : loaded.input;
    // The read the founder just saw (2026-10-16): context to stay consistent with, never a new citable ref. Its top
    // theses join the gate context, so the strategy must trace to them (and never to a reversed one).
    const input: StrategyModelInput = opts.understandingRead ? { ...withResults, understandingRead: opts.understandingRead } : withResults;
    if (opts.understandingRead?.theses?.length) ctx.theses = opts.understandingRead.theses.map((t) => ({ id: t.id, status: t.status, text: [t.headline, t.relationship, t.implication, t.question ?? ''].join(' ') }));
    if (results.length) ctx.business.push(...results.map((r) => ({ ref: r.ref, text: `Observed result: ${r.statement}` })));
    const assumed = !loaded.hasGoal ? (opts.assumedGoal ?? '').trim() : '';
    if (assumed) {
      // input.founderState and ctx.founder are the same array: the gates see the assumed goal too.
      input.founderState.push({ ref: `F${input.founderState.length + 1}`, kind: 'goal', statement: `ASSUMED (the founder did not state a goal): remove this constraint — ${assumed}` });
    }
    const hasGoal = loaded.hasGoal || Boolean(assumed);

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
      // Every failing component in ONE repair (2026-10-17), the central choice first: one component per attempt ran out of
      // attempts before the positioning was reached, and the central fields cannot be omitted afterwards.
      const components = [...new Set(v.failures.map((x) => x.component))].sort((a, b) => centralRank(a) - centralRank(b));
      this.deps.log?.({ type: 'repair_attempt', component: components.join(', '), gate: v.failures[0]!.gate, attempt: attempts });
      try {
        const reasons = components.flatMap((c) => v.failures.filter((x) => x.component === c).map((x) => `[${c}] ${x.gate}: ${x.detail}`));
        const r = await this.deps.model.repair({ ...input, current: bundle, failedComponent: components.join(', '), failureReason: [...new Set(reasons)].join('\n') });
        bundle = r.strategy;
      } catch { break; }
      v = validateStrategy(bundle, ctx);
      this.deps.log?.({ type: 'repair_result', attempt: attempts, failures: v.failures.map((x) => `${x.gate}:${x.component}`) });
    }
    if (!v.pass) ({ bundle, v } = this.secondaryFallback(bundle, v, ctx, language));
    if (!v.pass) {
      this.deps.log?.({ type: 'failed_closed', gate: v.failures[0]?.gate ?? 'unknown' });
      return this.persist(businessId, bundle, 'insufficient', v.gateResults, input, language);
    }

    // A capacity the bet depends on and the evidence does not establish is checked first, never assumed (2026-10-17).
    ({ bundle, v } = this.capacityFirst(bundle, v, ctx, language));

    // ── judged layer: grounding / genericity nuance / coherence / fit; repair failed dimensions ──
    let gateResults: StrategyGateResult[] = v.gateResults;
    let judgeAttempts = 0;
    try {
      let judged = await this.deps.model.judge({ ...input, strategy: bundle });
      this.deps.log?.({ type: 'judge_round', round: 1, verdicts: judged.verdicts.map((jv) => ({ ...jv })) });
      while (judged.verdicts.some((jv) => !jv.pass) && judgeAttempts < MAX_JUDGE_REPAIRS) {
        judgeAttempts += 1;
        const bad = judged.verdicts.find((jv) => !jv.pass)!;
        this.deps.log?.({ type: 'judge_repair', dimension: bad.dimension, component: bad.component, attempt: judgeAttempts });
        try {
          const r = await this.deps.model.repair({ ...input, current: bundle, failedComponent: bad.component, failureReason: `${bad.dimension}: ${bad.reason}` });
          bundle = r.strategy;
        } catch { break; }
        let rv = validateStrategy(bundle, ctx); // repair must not break deterministic gates
        if (!rv.pass) ({ bundle, v: rv } = this.secondaryFallback(bundle, rv, ctx, language));
        this.deps.log?.({ type: 'judge_repair_result', attempt: judgeAttempts, gatesPass: rv.pass });
        if (!rv.pass) { this.deps.log?.({ type: 'failed_closed', gate: rv.failures[0]?.gate ?? 'judge_repair_broke_structure' }); return this.persist(businessId, bundle, 'insufficient', rv.gateResults, input, language); }
        ({ bundle, v: rv } = this.capacityFirst(bundle, rv, ctx, language));
        gateResults = rv.gateResults;
        judged = await this.deps.model.judge({ ...input, strategy: bundle });
        this.deps.log?.({ type: 'judge_round', round: judgeAttempts + 1, verdicts: judged.verdicts.map((jv) => ({ ...jv })) });
      }
      // Failures left after the allowed repairs: settled deterministically when they point only at secondary parts.
      const failedVerdicts = judged.verdicts.filter((jv) => !jv.pass);
      const settled = failedVerdicts.length ? resolveJudgeFailures(bundle, failedVerdicts, ctx) : null;
      if (settled && !settled.unresolved.length) {
        bundle = settled.bundle;
        this.deps.log?.({ type: 'judge_fallback', resolved: settled.resolved });
      }
      const how = new Map((settled && !settled.unresolved.length ? settled.resolved : []).map((r) => [r.dimension, r.how]));
      gateResults = [...gateResults, ...judged.verdicts.map((jv) => ({ gate: `judge:${jv.dimension}`, pass: jv.pass || how.has(jv.dimension), detail: jv.pass ? 'ok' : how.has(jv.dimension) ? `settled: ${how.get(jv.dimension)} (judge: ${jv.reason})` : jv.reason }))];
      if (gateResults.some((g) => g.gate.startsWith('judge:') && !g.pass)) {
        this.deps.log?.({ type: 'failed_closed', gate: `judge:${judged.verdicts.find((jv) => !jv.pass && !how.has(jv.dimension))!.dimension}` });
        return this.persist(businessId, bundle, 'insufficient', gateResults, input, language);
      }
    } catch {
      // judge unavailable → deterministic pass stands (do not fail an otherwise-valid proposal).
    }

    this.deps.log?.(attempts > 0 ? { type: 'repaired_ok', attempts } : { type: 'first_pass_ok' });
    return this.persist(businessId, bundle, 'proposal', gateResults, input, language);
  }

  /** Capacity checked before the bet (see addCapacityPrerequisite); kept only if every deterministic gate still passes. */
  private capacityFirst(bundle: StrategyBundle, v: StrategyValidation, ctx: StrategyContextForGate, language: string): { bundle: StrategyBundle; v: StrategyValidation } {
    const c = addCapacityPrerequisite(bundle, ctx, language);
    if (!c.added) return { bundle, v };
    const cv = validateStrategy(c.bundle, ctx);
    if (!cv.pass) return { bundle, v };
    this.deps.log?.({ type: 'capacity_prerequisite', added: c.added });
    return { bundle: c.bundle, v: cv };
  }

  /** One unsupported sentence in secondary copy never sinks a valid strategy: omit it (see omitUnsupportedSecondary). */
  private secondaryFallback(bundle: StrategyBundle, v: StrategyValidation, ctx: StrategyContextForGate, language: string): { bundle: StrategyBundle; v: StrategyValidation } {
    const s = omitUnsupportedSecondary(bundle, ctx, language);
    if (!s.omitted.length) return { bundle, v };
    const sv = validateStrategy(s.bundle, ctx);
    if (!sv.pass) return { bundle, v };
    this.deps.log?.({ type: 'secondary_omitted', omitted: s.omitted });
    return { bundle: s.bundle, v: sv };
  }

  private async persist(businessId: string, bundle: StrategyBundle, status: 'proposal' | 'insufficient', gateResults: StrategyGateResult[], input: StrategyModelInput, language: string): Promise<StrategyVersionRecord> {
    // An assumed goal (see generate) is recorded on the bundle, so every surface that shows this version can flag it.
    const assumedRow = input.founderState.find((f) => f.kind === 'goal' && f.statement.startsWith('ASSUMED (the founder did not state a goal): remove this constraint — '));
    if (assumedRow) bundle = { ...bundle, core: { ...bundle.core, assumedGoal: assumedRow.statement.replace('ASSUMED (the founder did not state a goal): remove this constraint — ', '') } };
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
