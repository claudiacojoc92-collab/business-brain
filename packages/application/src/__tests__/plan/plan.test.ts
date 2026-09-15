/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { PlanService, validatePlan, deriveReadiness, detectActionKeyLeaks, founderMaterialStatements } from '../../plan/index';
import type { IPlanRepository, IPlanModelPort, PlanStrategyView, PlanDraft, PlanVersion, PlanLifecycleEvent, ActionStateEntry, CreateHandoff, PlanGenerationTrace } from '../../plan/contracts';

function inMemoryRepo() {
  const versions: PlanVersion[] = []; const events: Omit<PlanLifecycleEvent, 'id'>[] = []; const ledger: Omit<ActionStateEntry, 'id'>[] = []; const handoffs: CreateHandoff[] = []; const traces: Omit<PlanGenerationTrace, 'id'>[] = [];
  const repo: IPlanRepository = {
    savePlanVersion: async (p) => { versions.push(p); },
    getPlanVersion: async (bid, id) => versions.find((v) => v.businessId === bid && v.planVersionId === id) ?? null,
    recordLifecycle: async (e) => { events.push(e); },
    listLifecycle: async (bid) => events.filter((e) => e.businessId === bid).map((e, i) => ({ id: `e${i}`, ...e })),
    appendActionState: async (e) => { ledger.push(e); },
    listActionStates: async (bid, pv) => ledger.filter((e) => e.businessId === bid && e.planVersionId === pv).map((e, i) => ({ id: `l${i}`, ...e })),
    saveCreateHandoff: async (h) => { handoffs.push(h); },
    saveGenerationTrace: async (t) => { traces.push(t); },
  };
  return { repo, versions, events, ledger, handoffs, traces };
}

const STRATEGY: PlanStrategyView = {
  strategyVersionId: 'sv1', goal: 'win more consulting clients', coreBet: 'win trust by publishing concrete client outcomes',
  decisions: ['lead with proof of outcomes', 'focus on fractional CFOs', 'convert via a short intro call'],
  audience: 'fractional CFOs at seed startups', ctaDirection: 'book a short intro call',
  licensedMaterial: ['a recent client outcome writeup', 'the offer one-pager'],
  authorizedNumbers: [
    { value: '20 qualified leads', kind: 'count', sourceRef: 'goal', appliesTo: 'qualified leads for the intro-call offer' },
    { value: 'September 15', kind: 'date', sourceRef: 'launch decision', appliesTo: 'launch the intro-call offer' },
  ],
};

const validDraft = (over: Partial<PlanDraft> = {}): PlanDraft => ({
  monthDirection: 'Turn your proof of client outcomes into booked intro calls with fractional CFOs.',
  priorities: [
    { title: 'Publish concrete client-outcome proof', intent: 'content', why: 'executes the bet to win trust with proof of outcomes', betRef: 'lead with proof of outcomes', goalRef: 'win more consulting clients', timeBand: 'weeks 1-2', feasibility: 'feasible', materialGap: null, observableSignal: { description: 'replies from CFOs', source: 'strategy' }, order: 0,
      actions: [{ key: 'a1', what: 'Write up a recent client outcome as a short proof piece', why: 'proof executes the bet', doneDefinition: 'one proof piece drafted', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: ['a recent client outcome writeup'], prerequisiteKeys: [], planTimeFeasible: true }] },
    { title: 'Set up the intro-call conversion path', intent: 'conversion_path', why: 'convert proof readers into intro calls', betRef: 'convert via a short intro call', goalRef: 'win more consulting clients', timeBand: 'weeks 2-3', feasibility: 'feasible', materialGap: null, observableSignal: { description: 'booked intro calls', source: 'strategy' }, order: 1,
      actions: [{ key: 'b1', what: 'Add a clear intro-call booking link to outreach to CFOs', why: 'removes friction to the CTA', doneDefinition: 'booking link live', effortHint: 'quick', leadsToCreate: false, requiredMaterial: [], prerequisiteKeys: [], planTimeFeasible: true }] },
  ],
  currentFocusIndex: 0, notNow: [], ...over,
});

const modelReturning = (draft: PlanDraft | (() => PlanDraft)): IPlanModelPort => ({ draftPlan: async () => (typeof draft === 'function' ? draft() : draft) });
const svc = (model: IPlanModelPort, repo = inMemoryRepo()) => ({ service: new PlanService({ plan: repo.repo, model, currentStrategy: async () => STRATEGY, clock: () => '2026-01-01T00:00:00.000Z' }), repo });

describe('Slice 5 — Plan (strategy→execution) corrections', () => {
  it('generates a valid PROPOSED plan (strategy-derived, business-specific)', async () => {
    const { service, repo } = svc(modelReturning(validDraft()));
    const plan = await service.generateProposedPlan('B');
    expect(plan).not.toBeNull();
    expect(validatePlan(plan!, STRATEGY).valid).toBe(true);
    expect(repo.events.some((e) => e.kind === 'proposed')).toBe(true);
  });

  // ── A. Immutability: adoption/supersession never mutate plan content ──
  it('A. accepting + superseding does NOT mutate PlanVersion content (hash stable)', async () => {
    const { service, repo } = svc(modelReturning(validDraft()));
    const p1 = (await service.generateProposedPlan('B'))!;
    const hash0 = p1.contentHash;
    await service.acceptPlan('B', p1.planVersionId);
    // a second plan is generated + adopted, superseding the first
    const p2 = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', p2.planVersionId);
    const reloaded = await repo.repo.getPlanVersion('B', p1.planVersionId);
    expect(reloaded!.contentHash).toBe(hash0);                 // content unchanged
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(p1)); // byte-identical
    const active = await service.getActivePlan('B');
    expect(active!.plan.planVersionId).toBe(p2.planVersionId); // exactly one active = the latest adopted
  });

  // ── B. Readiness derived from ledger, not stored on the action ──
  it('B. a prerequisite blocks; completing it via the ledger makes the action READY (no plan mutation)', async () => {
    const draft = validDraft({ priorities: [{ title: 'Proof then convert', intent: 'conversion_path', why: 'sequence proof before conversion for fractional CFOs', betRef: 'convert via a short intro call', goalRef: 'win more consulting clients', timeBand: 'weeks 1-2', feasibility: 'feasible', materialGap: null, observableSignal: null, order: 0,
      actions: [
        { key: 'B', what: 'Draft the proof piece from the client outcome', why: 'proof first', doneDefinition: 'proof drafted', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: [], prerequisiteKeys: [], planTimeFeasible: true },
        { key: 'A', what: 'Send the proof to CFOs with the intro-call link', why: 'convert after proof', doneDefinition: 'sent', effortHint: 'quick', leadsToCreate: false, requiredMaterial: [], prerequisiteKeys: ['B'], planTimeFeasible: true },
      ] }] });
    const { service } = svc(modelReturning(draft));
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const A = plan.priorities[0]!.actions.find((a) => a.what.startsWith('Send'))!;
    const B = plan.priorities[0]!.actions.find((a) => a.what.startsWith('Draft'))!;
    let today = (await service.today('B'))!;
    expect(today.ready.map((a) => a.actionId)).toContain(B.actionId);
    expect(today.ready.map((a) => a.actionId)).not.toContain(A.actionId); // A blocked by prereq B
    await service.applyOutcome('B', plan.planVersionId, B.actionId, 'done', null);
    today = (await service.today('B'))!;
    expect(today.ready.map((a) => a.actionId)).toContain(A.actionId);     // A now READY, without editing A's row
  });

  // ── C. Create must not bias Today ranking ──
  it('C. a higher-leverage non-content action outranks a leadsToCreate content action', async () => {
    const draft = validDraft({ priorities: [{ title: 'Convert first, publish second', intent: 'conversion_path', why: 'the strategy prioritizes the intro-call conversion path for CFOs', betRef: 'convert via a short intro call', goalRef: 'win more consulting clients', timeBand: 'weeks 1-2', feasibility: 'feasible', materialGap: null, observableSignal: null, order: 0,
      actions: [
        { key: 'x1', what: 'Stand up the intro-call booking path for CFOs', why: 'unblocks outreach', doneDefinition: 'path live', effortHint: 'quick', leadsToCreate: false, requiredMaterial: [], prerequisiteKeys: [], planTimeFeasible: true },
        { key: 'c1', what: 'Draft a proof piece about a client outcome', why: 'content proof', doneDefinition: 'drafted', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: [], prerequisiteKeys: [], planTimeFeasible: true },
        { key: 'x2', what: 'Send outreach to CFOs via the booking path', why: 'depends on the path', doneDefinition: 'sent', effortHint: 'quick', leadsToCreate: false, requiredMaterial: [], prerequisiteKeys: ['x1'], planTimeFeasible: true },
      ] }] });
    const { service } = svc(modelReturning(draft));
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const today = (await service.today('B'))!;
    const x1 = plan.priorities[0]!.actions.find((a) => a.what.startsWith('Stand up'))!;
    expect(today.ready[0]!.actionId).toBe(x1.actionId); // non-content, higher unblock leverage → first, despite the create action
    expect(today.ready[0]!.leadsToCreate).toBe(false);
  });

  // ── D. Outcome numbers/dates are provenance-governed, not banned ──
  it('D. an authorized sourced OUTCOME number passes; an invented outcome number fails', async () => {
    const ok = validDraft({ priorities: [{ ...validDraft().priorities[0]!, observableSignal: { description: '20 qualified leads for the intro-call offer', source: 'strategy target' } }] });
    const okPlan = (await svc(modelReturning(ok)).service.generateProposedPlan('B'));
    expect(okPlan).not.toBeNull(); // "20 qualified leads" ∈ authorizedNumbers, same scope

    const bad = validDraft({ priorities: [{ ...validDraft().priorities[0]!, why: 'this will reach 7% conversion', observableSignal: { description: 'sign 30 new clients', source: null } }] });
    // validate directly (service would fail-closed → null)
    const composed: any = { ...okPlan, priorities: bad.priorities.map((p, i) => ({ ...p, priorityId: 'p', order: i, actions: p.actions.map((a) => ({ ...a, actionId: 'a', priorityId: 'p', prerequisites: [], effortHint: a.effortHint ?? null, materialGap: null })) })), currentFocusPriorityId: 'p', strategyVersionId: 'sv1' };
    const v = validatePlan(composed, STRATEGY);
    expect(v.valid).toBe(false);
    expect(v.failures.some((f) => f.startsWith('numeric_target') && f.includes('#invented'))).toBe(true); // 7% + 30 clients
  });

  // ── K. Scope-preserving OUTCOME-number authorization (correction #2): same token, wrong scope → rejected ──
  it('K. an outcome number under an unrelated scope is rejected; the correctly-scoped use passes; structural counts are free', () => {
    const build = (what: string): any => ({
      planVersionId: 'x', businessId: 'B', strategyVersionId: 'sv1', resourceEnvelope: { capacity: 'x', channels: [], constraints: [], notWilling: [], resources: [] },
      contextVersionRefs: [], monthDirection: 'Turn proof of client outcomes into intro calls with fractional CFOs.', currentFocusPriorityId: 'p0', producedAt: 't', contentHash: 'h', notNow: [],
      priorities: [{ priorityId: 'p0', title: 'Book intro calls with fractional CFOs', intent: 'conversion_path', why: 'executes the intro-call conversion bet', betRef: 'convert via a short intro call', goalRef: 'win more consulting clients', timeBand: 'weeks 1-2', feasibility: 'feasible', materialGap: null, observableSignal: null, order: 0,
        actions: [{ actionId: 'p0-a0', priorityId: 'p0', what, why: 'executes the bet', doneDefinition: 'done', effortHint: null, leadsToCreate: false, requiredMaterial: [], prerequisites: [], planTimeFeasible: true }] }],
    });
    // "20" authorized ONLY for "qualified leads"; reusing it for "subscribers" is a different meaning → reject.
    const misscoped = validatePlan(build('Get 20 newsletter subscribers from the campaign'), STRATEGY);
    expect(misscoped.failures.some((f) => f.startsWith('numeric_target') && f.includes('#misscoped'))).toBe(true);
    // the same number in its authorized scope (qualified leads for the intro-call offer) passes the gate.
    const scoped = validatePlan(build('Reach 20 qualified leads for the intro-call offer'), STRATEGY);
    expect(scoped.failures.some((f) => f.startsWith('numeric_target'))).toBe(false);
    // a bare "15" (date digit) used as a client count is NOT authorized by the "September 15" date.
    const dateConfusion = validatePlan(build('Sign 15 clients this month'), STRATEGY);
    expect(dateConfusion.failures.some((f) => f.startsWith('numeric_target'))).toBe(true);
    // structural/execution counts need NO provenance (correction #2): posts + emails are free.
    const structural = validatePlan(build('Publish 10 posts and send 2 emails to the list'), STRATEGY);
    expect(structural.failures.some((f) => f.startsWith('numeric_target'))).toBe(false);
  });

  // ── E. A legitimately narrow strategy → one priority, never padded ──
  it('E. one-priority plan is valid (no padding to two)', async () => {
    const one = validDraft({ priorities: [validDraft().priorities[0]!], currentFocusIndex: 0 });
    const plan = (await svc(modelReturning(one)).service.generateProposedPlan('B'))!;
    expect(plan.priorities).toHaveLength(1);
    expect(validatePlan(plan, STRATEGY).valid).toBe(true);
  });

  // ── F. Empty Not-now is valid; never fabricated ──
  it('F. empty notNow passes', async () => {
    const plan = (await svc(modelReturning(validDraft({ notNow: [] }))).service.generateProposedPlan('B'))!;
    expect(plan.notNow).toEqual([]);
    expect(validatePlan(plan, STRATEGY).valid).toBe(true);
  });

  // ── core: contract rejections + lifecycle + fail-closed + handoff ──
  it('rejects a generic (transplantable) plan and manufactured urgency / unsupported promise', async () => {
    const generic: any = { planVersionId: 'x', businessId: 'B', strategyVersionId: 'sv1', resourceEnvelope: { capacity: 'x', channels: [], constraints: [], notWilling: [], resources: [] }, contextVersionRefs: [], monthDirection: 'Post consistently and engage daily.', currentFocusPriorityId: 'p0', producedAt: 't', contentHash: 'h', notNow: [],
      priorities: [{ priorityId: 'p0', title: 'Post more often', intent: 'content', why: 'grow', betRef: 'grow', goalRef: 'grow', timeBand: 'weeks 1-2', feasibility: 'feasible', materialGap: null, observableSignal: null, order: 0,
        actions: [{ actionId: 'p0-a0', priorityId: 'p0', what: 'Post daily — guaranteed to double your leads, act fast', why: 'engagement', doneDefinition: 'posted', effortHint: null, leadsToCreate: true, requiredMaterial: [], prerequisites: [], planTimeFeasible: true }] }] };
    const v = validatePlan(generic, STRATEGY);
    expect(v.valid).toBe(false);
    expect(v.failures).toEqual(expect.arrayContaining(['generic_plan_transplantable', 'manufactured_urgency', 'unsupported_outcome_promise']));
  });

  it('proposed plan is not active until adoption; only the active plan feeds Today', async () => {
    const { service } = svc(modelReturning(validDraft()));
    const plan = (await service.generateProposedPlan('B'))!;
    expect(await service.getActivePlan('B')).toBeNull();  // proposed, not active
    expect(await service.today('B')).toBeNull();
    await service.acceptPlan('B', plan.planVersionId);
    expect((await service.getActivePlan('B'))!.plan.planVersionId).toBe(plan.planVersionId);
    expect((await service.today('B'))!.ready.length).toBeGreaterThan(0);
  });

  it('fail-closed: a persistently invalid draft yields no proposed plan (null)', async () => {
    const badModel = modelReturning({ monthDirection: 'x', priorities: [], currentFocusIndex: 0, notNow: [] }); // 0 priorities → invalid
    const { service, repo } = svc(badModel);
    expect(await service.generateProposedPlan('B')).toBeNull();
    expect(repo.versions).toHaveLength(0);
  });

  // ── Readiness material availability is a MEANING match, not string equality (live-corpus fix) ──
  it('L. a paraphrased required material still counts as available (not falsely blocked)', async () => {
    const d = validDraft({ priorities: [{ ...validDraft().priorities[0]!, actions: [
      { key: 'm1', what: 'Draft the proof piece', why: 'proof executes the bet', doneDefinition: 'drafted', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: ['recent client outcome writeup'], prerequisiteKeys: [], planTimeFeasible: true },
    ] }] });
    // strategy licenses "a recent client outcome writeup"; the action asks for "recent client outcome writeup"
    const { service } = svc(modelReturning(d));
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const today = (await service.today('B'))!;
    expect(today.ready.length).toBe(1);                // available despite the "a " paraphrase
    expect(today.blockedFallback).toBeNull();
  });

  // ── Semantic causal-derivation judge gates generation (correction #1, revised) ──
  it('M. a plan the causal-derivation judge deems generic is rejected (fail-closed) even if deterministically valid', async () => {
    const judgeModel: IPlanModelPort = { draftPlan: async () => validDraft(), reviewGenericity: async () => ({ generic: true, failures: [{ ref: 'Publish concrete client-outcome proof', reason: 'common best practice', missingDerivation: 'no strategy link' }] }) };
    const { service, repo } = svc(judgeModel);
    expect(await service.generateProposedPlan('B')).toBeNull();  // deterministically valid, but semantically generic → not shipped
    expect(repo.versions).toHaveLength(0);
    expect(repo.traces.at(-1)!.finalDisposition).toBe('fail_closed'); // trace persisted
    expect(repo.traces.at(-1)!.attempts.some((a) => a.disposition === 'semantic_failed')).toBe(true);
  });
  it('M2. a plan the causal-derivation judge accepts (shared tactic, strategy-entailed) is proposed', async () => {
    const judgeModel: IPlanModelPort = { draftPlan: async () => validDraft(), reviewGenericity: async () => ({ generic: false, failures: [] }) };
    const { service, repo } = svc(judgeModel);
    expect(await service.generateProposedPlan('B')).not.toBeNull();
    expect(repo.traces.at(-1)!.finalDisposition).toBe('proposed');
  });

  // ── Repair loop: a draft THROW consumes one attempt and generation continues (implementation-bug fix) ──
  it('N. a transient draft throw consumes one attempt; a later good draft still produces a plan', async () => {
    let n = 0;
    const flaky: IPlanModelPort = { draftPlan: async () => { n += 1; if (n === 1) throw new Error('malformed JSON'); return validDraft(); } };
    const { service, repo } = svc(flaky);
    expect(await service.generateProposedPlan('B')).not.toBeNull();
    expect(repo.traces.at(-1)!.attempts[0]!.disposition).toBe('threw');
    expect(repo.traces.at(-1)!.attempts.some((a) => a.disposition === 'accepted')).toBe(true);
  });
  it('N2. repeated draft throws exhaust the budget and fail closed (trace records the throws)', async () => {
    const alwaysThrow: IPlanModelPort = { draftPlan: async () => { throw new Error('model down'); } };
    const { service, repo } = svc(alwaysThrow);
    expect(await service.generateProposedPlan('B')).toBeNull();
    const t = repo.traces.at(-1)!;
    expect(t.finalDisposition).toBe('fail_closed');
    expect(t.attempts.length).toBeGreaterThanOrEqual(4);
    expect(t.attempts.every((a) => a.disposition === 'threw')).toBe(true);
  });

  it('CreateHandoff is emitted for a Create action and traces to strategy; a non-create action is rejected', async () => {
    const { service } = svc(modelReturning(validDraft()));
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const createAction = plan.priorities[0]!.actions[0]!;       // leadsToCreate true
    const handoff = await service.emitCreateHandoff('B', createAction.actionId);
    expect(handoff.strategyVersionId).toBe('sv1');
    expect(handoff.strategicBetTrace).toBe('lead with proof of outcomes');
    expect(handoff.founderGoalTrace).toBe('win more consulting clients');
    expect(handoff.authorizedAudienceUseContext).toBe(STRATEGY.audience);
    const nonCreate = plan.priorities[1]!.actions[0]!;          // leadsToCreate false
    await expect(service.emitCreateHandoff('B', nonCreate.actionId)).rejects.toThrow(/does not lead to Create/i);
  });

  it('emitCreateHandoffFromConcept mints a strategy-traced handoff from an approved concept (no plan action needed)', async () => {
    const { service, repo } = svc(modelReturning(validDraft())); // no active plan adopted
    const h = await service.emitCreateHandoffFromConcept('B', { objective: 'A carousel on the recent client-outcome proof', channel: 'carousel', format: 'carousel' });
    expect(h.executionObjective).toBe('A carousel on the recent client-outcome proof');
    expect(h.strategyVersionId).toBe('sv1');
    expect(h.strategicBetTrace).toBe(STRATEGY.coreBet);   // traced to the held strategy, not a plan action
    expect(h.founderGoalTrace).toBe(STRATEGY.goal);
    expect(h.requestedAssetFormat).toBe('carousel');
    expect(h.authorizedAudienceUseContext).toBe(STRATEGY.audience);
    expect(repo.handoffs.some((x) => x.createHandoffId === h.createHandoffId)).toBe(true); // persisted like any handoff
    await expect(service.emitCreateHandoffFromConcept('B', { objective: '   ', format: 'carousel' })).rejects.toThrow(/objective/i);
  });
});

// ── P0: kind-specific resolution of a BLOCKED move (resource / constraint / decision) ──
describe('Slice 5 — blocked-move resolution semantics (P0)', () => {
  // A plan with a single blocked action requiring an unlicensed material, and a resource-union harness that
  // mirrors composition-root: a recorded `resource` folds into the strategy's licensedMaterial.
  const materialDraft = (required: string): PlanDraft => validDraft({ priorities: [{ ...validDraft().priorities[0]!, actions: [
    { key: 'm1', what: 'Publish the proof piece using the brand assets', why: 'proof executes the bet', doneDefinition: 'published', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: [required], prerequisiteKeys: [], planTimeFeasible: true },
  ] }], currentFocusIndex: 0 });

  function harness(draft: PlanDraft) {
    const repo = inMemoryRepo();
    const extraMaterial = new Set<string>();
    const recorded: Array<{ kind: string; statement: string; actionId: string; founderId: string }> = [];
    const service = new PlanService({
      plan: repo.repo,
      model: modelReturning(draft),
      currentStrategy: async () => ({ ...STRATEGY, licensedMaterial: [...STRATEGY.licensedMaterial, ...extraMaterial] }),
      recordFounderState: async (i) => { recorded.push(i); if (i.kind === 'resource') extraMaterial.add(i.statement); },
      clock: () => '2026-01-01T00:00:00.000Z',
    });
    return { service, repo, recorded, extraMaterial };
  }

  it('C1. missing_material → "I have this" records a RESOURCE (not a correction) and the SAME action re-derives READY', async () => {
    const { service, recorded } = harness(materialDraft('brand logo files'));
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const before = (await service.today('B'))!;
    expect(before.ready).toHaveLength(0);
    expect(before.blockedFallback!.blocker.kind).toBe('missing_material');
    expect(before.blockedFallback!.blocker.material).toBe('brand logo files'); // structured, founder-facing material
    const blockedId = before.blockedFallback!.action.actionId;
    await service.recordActionResolution('B', 'f1', blockedId, 'resource', 'brand logo files', 'en');
    expect(recorded).toEqual([{ businessId: 'B', founderId: 'f1', actionId: blockedId, kind: 'resource', statement: 'brand logo files', language: 'en' }]);
    const after = (await service.today('B'))!;
    expect(after.ready.map((a) => a.actionId)).toContain(blockedId); // re-derived READY — completed normally next (no auto-done)
    // and no terminal outcome was written (the action is not falsely done)
    expect(after.ready.find((a) => a.actionId === blockedId)).toBeTruthy();
  });

  it('C2. missing_material → "I can\'t get it" is a constraint + SKIP (never DONE); the move leaves Today', async () => {
    const { service } = harness(materialDraft('a paid stock-photo subscription'));
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const blockedId = (await service.today('B'))!.blockedFallback!.action.actionId;
    await service.recordActionResolution('B', 'f1', blockedId, 'constraint', 'I won’t buy a stock subscription', 'en');
    await service.applyOutcome('B', plan.planVersionId, blockedId, 'skipped', 'I won’t buy a stock subscription');
    const after = (await service.today('B'))!;
    expect(after.ready.map((a) => a.actionId)).not.toContain(blockedId);
    expect(after.blockedFallback?.action.actionId).not.toBe(blockedId); // not re-shown as blocked
  });

  it('D. founder_decision → decision fact + DONE completes the decision action and unblocks dependents', async () => {
    // an action that needs a decision (not plan-time feasible, no material) blocks a dependent
    const draft = validDraft({ priorities: [{ ...validDraft().priorities[0]!, actions: [
      { key: 'dec', what: 'Decide which single audience to lead with', why: 'the plan can’t proceed until you choose', doneDefinition: 'chosen', effortHint: 'quick', leadsToCreate: false, requiredMaterial: [], prerequisiteKeys: [], planTimeFeasible: false },
      { key: 'nxt', what: 'Write the proof piece for the chosen audience', why: 'depends on the choice', doneDefinition: 'drafted', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: [], prerequisiteKeys: ['dec'], planTimeFeasible: true },
    ] }] });
    const { service, recorded } = harness(draft);
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const t0 = (await service.today('B'))!;
    expect(t0.blockedFallback!.blocker.kind).toBe('founder_decision');
    const decId = t0.blockedFallback!.action.actionId;
    await service.recordActionResolution('B', 'f1', decId, 'decision', 'lead with fractional CFOs', 'en');
    await service.applyOutcome('B', plan.planVersionId, decId, 'done', 'lead with fractional CFOs');
    expect(recorded[0]!.kind).toBe('decision');
    const t1 = (await service.today('B'))!;
    expect(t1.ready.some((a) => a.what.startsWith('Write the proof'))).toBe(true); // dependent unblocked
  });

  it('E. prerequisite_unfinished carries the PREREQUISITE ref; "already done" applies to A, never the blocked child', async () => {
    // B (blocked child) depends on A; A is not plan-time feasible so it needs a decision and B waits on it.
    const draft = validDraft({ priorities: [{ ...validDraft().priorities[0]!, actions: [
      { key: 'A', what: 'Confirm the case study is cleared to publish', why: 'gate', doneDefinition: 'cleared', effortHint: 'quick', leadsToCreate: false, requiredMaterial: [], prerequisiteKeys: [], planTimeFeasible: true },
      { key: 'Bc', what: 'Publish the cleared case study', why: 'after clearance', doneDefinition: 'published', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: [], prerequisiteKeys: ['A'], planTimeFeasible: true },
    ] }] });
    const { service } = harness(draft);
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const A = plan.priorities[0]!.actions.find((a) => a.what.startsWith('Confirm'))!;
    const child = plan.priorities[0]!.actions.find((a) => a.what.startsWith('Publish'))!;
    // Skip A so it is terminal-non-done → the child becomes blocked on the (unfinished) prerequisite A.
    await service.applyOutcome('B', plan.planVersionId, A.actionId, 'skipped', 'set aside');
    const t0 = (await service.today('B'))!;
    expect(t0.ready).toHaveLength(0);
    expect(t0.blockedFallback!.blocker.kind).toBe('prerequisite_unfinished');
    expect(t0.blockedFallback!.blocker.ref).toBe(A.actionId);   // the thing to resolve is A…
    expect(t0.blockedFallback!.action.actionId).toBe(child.actionId); // …not the blocked child
  });

  it('F. recordActionResolution requires a non-empty statement and a configured writer', async () => {
    const { service } = harness(materialDraft('x'));
    await expect(service.recordActionResolution('B', 'f1', 'a', 'resource', '   ', 'en')).rejects.toThrow(/statement/i);
    const noWriter = new PlanService({ plan: inMemoryRepo().repo, model: modelReturning(materialDraft('x')), currentStrategy: async () => STRATEGY, clock: () => 't' });
    await expect(noWriter.recordActionResolution('B', 'f1', 'a', 'resource', 'y', 'en')).rejects.toThrow(/not configured/i);
  });
});

// ── founder_state KIND BOUNDARY: only RESOURCE is material; constraint/decision/correction never pollute ──
describe('Slice 5 — founder_state kind boundary (only resource feeds availableMaterial)', () => {
  const act = (requiredMaterial: string[]): any => ({ actionId: 'a', priorityId: 'p', what: 'x', why: 'y', doneDefinition: 'z', effortHint: null, leadsToCreate: false, requiredMaterial, prerequisites: [], planTimeFeasible: true });
  const readinessFrom = (required: string, states: { kind: string; statement: string }[]) =>
    deriveReadiness(act([required]), new Map(), { strategyStale: false, decisionNeeded: new Set<string>(), availableMaterial: new Set(founderMaterialStatements(states)) });
  // deterministic matcher, exposed to prove the danger is REAL (a poisoned set WOULD match) — so the KIND filter is load-bearing
  const wouldMatchIfPoisoned = (required: string, statement: string) =>
    deriveReadiness(act([required]), new Map(), { strategyStale: false, decisionNeeded: new Set<string>(), availableMaterial: new Set([statement]) }).readiness;

  it('CASE A — a RESOURCE for the exact required material makes it AVAILABLE (ready)', () => {
    const states = [{ kind: 'resource', statement: 'access to East Fork color pages' }];
    expect(founderMaterialStatements(states)).toEqual(['access to East Fork color pages']);
    expect(readinessFrom('access to East Fork color pages', states).readiness).toBe('ready');
  });

  it('CASE B — a CONSTRAINT echoing the material stays BLOCKED (missing_material), though it WOULD match if poisoned', () => {
    const states = [{ kind: 'constraint', statement: 'I can’t access the East Fork color pages' }];
    expect(founderMaterialStatements(states)).toEqual([]);                          // kind filter drops the constraint
    const r = readinessFrom('East Fork color pages', states);
    expect(r.readiness).toBe('blocked');
    expect(r.blocker?.kind).toBe('missing_material');
    // proof the risk was real: had the constraint entered the set, ≥3-token containment WOULD have unblocked it
    expect(wouldMatchIfPoisoned('East Fork color pages', 'I can’t access the East Fork color pages')).toBe('ready');
  });

  // Living State (TUNE read-path): an operating constraint SCOPED to an action blocks that action so Today
  // re-derives to the next non-conflicting move — no plan mutation.
  it('CASE C — an operating constraint scoped to an action BLOCKS it (operating_constraint), untouched otherwise', () => {
    const noConstraint = deriveReadiness(act([]), new Map(), { strategyStale: false, decisionNeeded: new Set<string>(), availableMaterial: new Set<string>() });
    expect(noConstraint.readiness).toBe('ready');
    const constrained = deriveReadiness(act([]), new Map(), {
      strategyStale: false, decisionNeeded: new Set<string>(), availableMaterial: new Set<string>(),
      constrainedActions: new Map([['a', 'No kinetotherapy Tue/Thu evenings']]),
    });
    expect(constrained.readiness).toBe('blocked');
    expect(constrained.blocker?.kind).toBe('operating_constraint');
    expect(constrained.blocker?.detail).toBe('No kinetotherapy Tue/Thu evenings');
    // a constraint scoped to a DIFFERENT action leaves this one ready
    const other = deriveReadiness(act([]), new Map(), {
      strategyStale: false, decisionNeeded: new Set<string>(), availableMaterial: new Set<string>(),
      constrainedActions: new Map([['other', 'x']]),
    });
    expect(other.readiness).toBe('ready');
  });

  it('CASE C — a DECISION not to use a material does NOT license it (stays blocked), though it WOULD match if poisoned', () => {
    const states = [{ kind: 'decision', statement: 'We won’t use customer product photography' }];
    expect(founderMaterialStatements(states)).toEqual([]);
    expect(readinessFrom('customer product photography', states).blocker?.kind).toBe('missing_material');
    expect(wouldMatchIfPoisoned('customer product photography', 'We won’t use customer product photography')).toBe('ready');
  });

  it('CASE D — a BUSINESS_CORRECTION mentioning the material words is never material availability', () => {
    const states = [{ kind: 'business_correction', statement: 'We have no customer product photography' }];
    expect(founderMaterialStatements(states)).toEqual([]);
    expect(readinessFrom('customer product photography', states).readiness).toBe('blocked');
  });

  it('mixed kinds: only the resource statement survives; constraint/decision/preference/correction are dropped', () => {
    expect(founderMaterialStatements([
      { kind: 'resource', statement: 'the offer one-pager' },
      { kind: 'constraint', statement: 'I can’t film video' },
      { kind: 'decision', statement: 'lead with fractional CFOs' },
      { kind: 'preference', statement: 'I prefer LinkedIn' },
      { kind: 'goal', statement: 'win 10 clients' },
      { kind: 'business_correction', statement: 'we only serve seed startups' },
    ])).toEqual(['the offer one-pager']);
  });

  // End-to-end through PlanService, mirroring the FIXED composition-root fold (licensedMaterial via founderMaterialStatements).
  it('E2E — recording a CONSTRAINT that echoes the required material does NOT unblock the action; only a RESOURCE does', async () => {
    const materialDraft = validDraft({ priorities: [{ ...validDraft().priorities[0]!, actions: [
      { key: 'm1', what: 'Publish the proof using the color pages', why: 'proof executes the bet', doneDefinition: 'published', effortHint: 'a_session', leadsToCreate: true, requiredMaterial: ['East Fork color pages'], prerequisiteKeys: [], planTimeFeasible: true },
    ] }], currentFocusIndex: 0 });
    const repo = inMemoryRepo();
    const states: { kind: string; statement: string }[] = [];
    const service = new PlanService({
      plan: repo.repo, model: modelReturning(materialDraft),
      // EXACT composition-root projection: only founderMaterialStatements(resource) join licensed material.
      currentStrategy: async () => ({ ...STRATEGY, licensedMaterial: [...STRATEGY.licensedMaterial, ...founderMaterialStatements(states)] }),
      recordFounderState: async (i) => { states.push({ kind: i.kind, statement: i.statement }); },
      clock: () => '2026-01-01T00:00:00.000Z',
    });
    const plan = (await service.generateProposedPlan('B'))!;
    await service.acceptPlan('B', plan.planVersionId);
    const blockedId = (await service.today('B'))!.blockedFallback!.action.actionId;
    // founder can't get it → constraint echoing the exact material words
    await service.recordActionResolution('B', 'f1', blockedId, 'constraint', 'I can’t access the East Fork color pages', 'en');
    const afterConstraint = (await service.today('B'))!;
    expect(afterConstraint.ready.map((a) => a.actionId)).not.toContain(blockedId);   // STILL blocked — no pollution
    expect(afterConstraint.blockedFallback!.blocker.kind).toBe('missing_material');
    // only a RESOURCE for the material actually unblocks it
    await service.recordActionResolution('B', 'f1', blockedId, 'resource', 'East Fork color pages', 'en');
    expect((await service.today('B'))!.ready.map((a) => a.actionId)).toContain(blockedId);
  });
});

// ── Corrected semantic classes: numeric role, urgency, material bridge (deterministic, no model) ──
describe('Slice 5 — corrected numeric / urgency / material semantics', () => {
  const plan = (what: string, why = 'executes the intro-call conversion bet'): any => ({
    planVersionId: 'x', businessId: 'B', strategyVersionId: 'sv1', resourceEnvelope: { capacity: 'x', channels: [], constraints: [], notWilling: [], resources: [] },
    contextVersionRefs: [], monthDirection: 'Turn proof into intro calls with fractional CFOs.', currentFocusPriorityId: 'p0', producedAt: 't', contentHash: 'h', notNow: [],
    priorities: [{ priorityId: 'p0', title: 'Book intro calls with fractional CFOs', intent: 'conversion_path', why: 'the intro-call conversion bet', betRef: 'convert via a short intro call', goalRef: 'win more consulting clients', timeBand: 'weeks 1-2', feasibility: 'feasible', materialGap: null, observableSignal: null, order: 0,
      actions: [{ actionId: 'p0-a0', priorityId: 'p0', what, why, doneDefinition: 'done', effortHint: null, leadsToCreate: false, requiredMaterial: [], prerequisites: [], planTimeFeasible: true }] }],
  });
  const numFails = (what: string): string[] => validatePlan(plan(what), STRATEGY).failures.filter((f) => f.startsWith('numeric_target'));

  it('C. "2 posts" and "two posts" get the identical (allowed) verdict — spelling cannot change safety', () => {
    expect(numFails('Publish 2 posts this week')).toEqual([]);
    expect(numFails('Publish two posts this week')).toEqual([]);
  });
  it('D2. execution counts are allowed without provenance', () => {
    expect(numFails('Send 2 emails, publish 1 post per week, and follow up once')).toEqual([]);
    expect(numFails('Ship 3 small actions across weeks 1-2')).toEqual([]);
  });
  it('E2. an invented OUTCOME number/deadline is rejected', () => {
    expect(numFails('Generate 20 subscribers and hit 7% conversion').length).toBeGreaterThan(0);
    expect(numFails('Launch by December 3').some((f) => f.includes('#invented') || f.includes('#misscoped'))).toBe(true);
  });
  it('F2. the scoped authorized outcome target is preserved', () => {
    expect(numFails('Reach 20 qualified leads for the intro-call offer')).toEqual([]);
    // and the authorized date in its scope
    expect(numFails('Launch the intro-call offer by September 15')).toEqual([]);
  });
  it('G. grounded seasonal/temporal context is allowed (not manufactured urgency)', () => {
    const v = validatePlan(plan('Send the outreach ahead of tax season, when finance pain peaks', 'timed to the real tax-season window'), STRATEGY);
    expect(v.failures).not.toContain('manufactured_urgency');
  });
  it('H. manufactured scarcity/pressure is rejected', () => {
    expect(validatePlan(plan('Post it now — act now before it’s too late, last chance!'), STRATEGY).failures).toContain('manufactured_urgency');
  });
  it('L. material bridge: article-normalized match passes; short substring false-positive does not', () => {
    const A = (requiredMaterial: string[]): any => ({ actionId: 'a', priorityId: 'p', what: 'x', why: 'y', doneDefinition: 'z', effortHint: null, leadsToCreate: false, requiredMaterial, prerequisites: [], planTimeFeasible: true });
    const inputs = { strategyStale: false, decisionNeeded: new Set<string>() };
    // article-normalized equality → available
    const avail1 = new Set(['a written case study of a SaaS client']);
    expect(deriveReadiness(A(['written case study of a SaaS client']), new Map(), { ...inputs, availableMaterial: avail1 }).readiness).toBe('ready');
    // short generic required must NOT match an arbitrary longer material
    const avail2 = new Set(['customer waitlist export']);
    expect(deriveReadiness(A(['list']), new Map(), { ...inputs, availableMaterial: avail2 }).readiness).toBe('blocked');
  });
});

// ── Proof-number provenance + tokenization + internal-key leak (deterministic) ──
describe('Slice 5 — proof-number provenance, tokenization, internal-key leak', () => {
  const PROOF_STRATEGY: PlanStrategyView = {
    ...STRATEGY, authorizedNumbers: [],
    licensedNumericFacts: [{ value: '30%', meaning: 'burn reduction', semanticScope: 'case-study client cut burn', sourceType: 'case_study', sourceRef: 'cs1' }],
  };
  const pl = (what: string): any => ({
    planVersionId: 'x', businessId: 'B', strategyVersionId: 'sv1', resourceEnvelope: { capacity: 'x', channels: [], constraints: [], notWilling: [], resources: [] },
    contextVersionRefs: [], monthDirection: 'Turn proof into intro calls with fractional CFOs.', currentFocusPriorityId: 'p0', producedAt: 't', contentHash: 'h', notNow: [],
    priorities: [{ priorityId: 'p0', title: 'Book intro calls with fractional CFOs', intent: 'positioning_expression', why: 'the proof bet', betRef: 'lead with proof of outcomes', goalRef: 'win more consulting clients', timeBand: 'weeks 1-2', feasibility: 'feasible', materialGap: null, observableSignal: null, order: 0,
      actions: [{ actionId: 'p0-a0', priorityId: 'p0', what, why: 'executes the bet', doneDefinition: 'done', effortHint: null, leadsToCreate: false, requiredMaterial: [], prerequisites: [], planTimeFeasible: true }] }],
  });
  const numFails = (what: string): string[] => validatePlan(pl(what), PROOF_STRATEGY).failures.filter((f) => f.startsWith('numeric_target'));

  it('A. a documented proof number cited faithfully/documentarily PASSES', () => {
    expect(numFails('Rewrite the case study, which documents a 30% burn reduction, into a LinkedIn post')).toEqual([]);
    expect(numFails('Lead with the client who cut burn 30% in the case study')).toEqual([]);
  });
  it('B. the same 30% as a forward target FAILS (scope mismatch)', () => {
    const f = numFails('Set a goal to target 30% conversion from the campaign');
    expect(f.some((x) => x.includes('#licensed_scope_mismatch') || x.includes('#invented'))).toBe(true);
  });
  it('C. the same 30% generalized to a reader outcome FAILS', () => {
    const f = numFails('Promise to increase customer results by 30%');
    expect(f.length).toBeGreaterThan(0);
  });
  it('D. hyphen/space/percent-word forms are all detected (tokenization loophole closed)', () => {
    expect(numFails('Aim to hit 30%-conversion this month').length).toBeGreaterThan(0);   // hyphen — the old loophole
    expect(numFails('Aim to hit 30 % conversion this month').length).toBeGreaterThan(0);   // space
    expect(numFails('Aim to hit 30 percent conversion this month').length).toBeGreaterThan(0); // word
    expect(numFails('Aim to hit 30-percent conversion this month').length).toBeGreaterThan(0); // hyphen-word
  });
  it('E. structural execution counts still pass (no regression)', () => {
    expect(numFails('Send 2 emails and publish 1 post per week')).toEqual([]);
    expect(numFails('Send two emails and publish one post per week')).toEqual([]);
  });

  const withProse = (why: string): any => ({ ...pl('Do the thing'), priorities: [{ ...pl('x').priorities[0], actions: [{ actionId: 'p0-a0', priorityId: 'p0', what: 'Draft the piece', why, doneDefinition: 'done', effortHint: null, leadsToCreate: false, requiredMaterial: [], prerequisites: [], planTimeFeasible: true }] }] });
  it('F. internal keys used only structurally (not in prose) PASS', () => {
    expect(detectActionKeyLeaks(withProse('after the earlier proof step is done'), ['a1', 'a2'])).toEqual([]);
    // and a real business term like "B2B" is never a false positive for key "b2"
    expect(detectActionKeyLeaks(withProse('target B2B security engineers'), ['b2'])).toEqual([]);
  });
  it('G. an internal key leaked into founder-facing prose FAILS', () => {
    expect(detectActionKeyLeaks(withProse('this is the same loop as a1 but with visual proof'), ['a1'])).toEqual(['internal_action_key_leak:a1']);
  });
  it('H. repair removes a leaked key → the corrected candidate persists', async () => {
    let n = 0;
    const flaky: IPlanModelPort = { draftPlan: async () => { n += 1; const d = validDraft(); if (n === 1) { const p = d.priorities[0]!; return { ...d, priorities: [{ ...p, actions: [{ ...p.actions[0]!, why: 'same as a1 step' }] }, d.priorities[1]!] }; } return d; } };
    const repo = inMemoryRepo();
    const service = new PlanService({ plan: repo.repo, model: flaky, currentStrategy: async () => STRATEGY, clock: () => '2026-01-01T00:00:00.000Z' });
    expect(await service.generateProposedPlan('B')).not.toBeNull();
    const t = repo.traces.at(-1)!;
    expect(t.attempts[0]!.deterministicFailures.some((x) => x.startsWith('internal_action_key_leak'))).toBe(true);
    expect(t.attempts.some((a) => a.disposition === 'accepted')).toBe(true);
  });
});
