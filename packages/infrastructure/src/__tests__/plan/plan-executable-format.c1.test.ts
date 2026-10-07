/* eslint-disable @typescript-eslint/no-explicit-any */
// C1 (BUS-7) + C3 (BUS-9): the closed ExecutableFormat vocabulary + required gathersFactClass on Action. Pins: an
// unknown format is coerced to null, a missing/unknown gathersFactClass stays ABSENT (C3 removed C1's 'none'
// default so the capability gate can fail it), valid values pass through, and plans stored before C1 read back
// with defaults while their stored content_hash is untouched.
import { describe, it, expect, vi } from 'vitest';
import { EXECUTABLE_FORMATS } from '@bb/application';
import { AnthropicPlanModel } from '../../business-intelligence/anthropic-plan.model';
import { PgPlanRepository } from '../../database/repositories/pg-plan.repository';

const STRATEGY: any = { strategyVersionId: 'sv1', goal: 'g', coreBet: 'b', decisions: [], audience: 'a', ctaDirection: 'c', licensedMaterial: [], authorizedNumbers: [] };
const ENVELOPE = { capacity: 'a few hours', channels: [], constraints: [], notWilling: [], resources: [] };

function modelReturning(actions: Record<string, unknown>[]): AnthropicPlanModel {
  const m = new AnthropicPlanModel('test-key');
  (m as any).call = vi.fn().mockResolvedValue({ monthDirection: 'd', currentFocusIndex: 0, notNow: [], priorities: [{ title: 't', intent: 'content', actions }] });
  return m;
}
const base = { what: 'w', why: 'y', doneDefinition: 'd', leadsToCreate: false, generatesDemand: false, requiredMaterial: [], prerequisiteKeys: [], planTimeFeasible: true };

describe('C1 — ExecutableFormat contract (no behaviour change)', () => {
  it('the vocabulary is exactly landing | carousel (a format enters only with a reachable surface)', () => {
    expect([...EXECUTABLE_FORMATS]).toEqual(['landing', 'carousel']);
  });

  it('leaves gathersFactClass ABSENT when the model omits it (C3: never defaulted), executableFormat=null', async () => {
    const draft = await modelReturning([{ key: 'a1', ...base }]).draftPlan({ strategy: STRATEGY, envelope: ENVELOPE, businessName: 'B' });
    const a = draft.priorities[0]!.actions[0]!;
    expect(a.executableFormat).toBeNull();
    expect(a.gathersFactClass).toBeUndefined();
  });

  it('passes valid values through and coerces anything outside the closed lists', async () => {
    const draft = await modelReturning([
      { key: 'a1', ...base, executableFormat: 'landing', gathersFactClass: 'service' },
      { key: 'a2', ...base, executableFormat: 'reel', gathersFactClass: 'price' },   // reel: no reachable surface; price: deferred class
    ]).draftPlan({ strategy: STRATEGY, envelope: ENVELOPE, businessName: 'B' });
    const actions = draft.priorities[0]!.actions; const a1 = actions[0]!; const a2 = actions[1]!;
    expect([a1.executableFormat, a1.gathersFactClass]).toEqual(['landing', 'service']);
    expect([a2.executableFormat, a2.gathersFactClass]).toEqual([null, undefined]);
  });

  it('reads a plan stored before C1 with the defaults and leaves its stored content_hash untouched', async () => {
    const legacyAction = { actionId: 'pv-p0-a0', priorityId: 'pv-p0', what: 'w', why: 'y', doneDefinition: 'd', effortHint: null, leadsToCreate: true, generatesDemand: false, requiredMaterial: [], prerequisites: [], planTimeFeasible: true };
    const row = {
      plan_version_id: 'pv', business_id: 'B', strategy_version_id: 'sv1', resource_envelope: JSON.stringify(ENVELOPE), context_version_refs: '[]',
      month_direction: 'd', priorities: JSON.stringify([{ priorityId: 'pv-p0', title: 't', actions: [legacyAction] }]),
      current_focus_priority_id: 'pv-p0', not_now: '[]', produced_at: '2026-10-01T00:00:00.000Z', content_hash: 'stored-hash',
    };
    const chain: any = {};
    chain.selectAll = () => chain; chain.where = () => chain; chain.executeTakeFirst = async () => row;
    const repo = new PgPlanRepository({ selectFrom: () => chain } as any);
    const plan = (await repo.getPlanVersion('B', 'pv'))!;
    const a = plan.priorities[0]!.actions[0]!;
    expect(a.executableFormat).toBeNull();
    expect(a.gathersFactClass).toBe('none');
    expect(a.leadsToCreate).toBe(true);           // existing facts unchanged
    expect(plan.contentHash).toBe('stored-hash'); // never recomputed on read
  });
});
