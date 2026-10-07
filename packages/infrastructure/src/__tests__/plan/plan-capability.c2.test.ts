/* eslint-disable @typescript-eslint/no-explicit-any */
// C2 (BUS-8): the planner is told what BB can DO (closed ExecutableFormat list) and what BB already HOLDS (fact
// classes), and is asked to set executableFormat + gathersFactClass per action. Pins the prompt contract and the
// user-message sections. Whether the live model follows it is checked by the live run recorded in the plan log.
import { describe, it, expect, vi } from 'vitest';
import { AnthropicPlanModel, PLAN_SYSTEM, capabilityLines } from '../../business-intelligence/anthropic-plan.model';

const STRATEGY: any = { strategyVersionId: 'sv1', goal: 'g', coreBet: 'b', decisions: [], audience: 'a', ctaDirection: 'c', licensedMaterial: [], authorizedNumbers: [] };
const ENVELOPE = { capacity: 'a few hours', channels: [], constraints: [], notWilling: [], resources: [] };

describe('C2 — planner knows what BB can do and what it holds', () => {
  it('PLAN_SYSTEM asks for both fields and states both rules', () => {
    expect(PLAN_SYSTEM).toContain('executableFormat');
    expect(PLAN_SYSTEM).toContain('gathersFactClass (REQUIRED on every action');
    expect(PLAN_SYSTEM).toContain('WHO DOES THE WORK');
    expect(PLAN_SYSTEM).toContain('NEVER ASK FOR WHAT BB ALREADY HOLDS');
    expect(PLAN_SYSTEM).toContain('"gathersFactClass":"none"');            // in the JSON shape
    expect(PLAN_SYSTEM).toContain('leadsToCreate (true EXACTLY when executableFormat is non-null');
  });

  it('defines "people" as the business\'s OWN team, so a list of outside contacts is "none" (live finding)', () => {
    // Live run 2026-10-07: "build the list of doctors to contact" was tagged "people" while BB held 13 team
    // members, which C3 would have rejected as asking for held info. Outside contacts are not a held class.
    expect(PLAN_SYSTEM).toContain('"people" (the business\'s OWN team');
    expect(PLAN_SYSTEM).toMatch(/OUTSIDE[\s\S]{0,60}people \(doctors, partners, referrers, prospects, clients to contact\) is "none"/);
  });

  it('defines gathering as COLLECTING existing facts; deciding or setting up something new is "none" (C3 live finding)', () => {
    // C3 live run 2026-10-07: "decide who on the team answers a referred patient" was tagged "people" and "agree a
    // standard reply with reception" "policy"; the gate rejected both as held info, dropping the receiving side.
    expect(PLAN_SYSTEM).toMatch(/COLLECTING facts that already exist; DECIDING or SETTING UP something new/);
  });

  it('lists every BB format when none are passed (a product constant) and only real formats when passed', () => {
    const all = capabilityLines(undefined, undefined).join('\n');
    expect(all).toMatch(/- landing — /);
    expect(all).toMatch(/- carousel — /);
    expect(all).toContain('(no catalogued facts yet)');
    const onlyLanding = capabilityLines(['landing', 'reel' as any], undefined).join('\n');
    expect(onlyLanding).toMatch(/- landing — /);
    expect(onlyLanding).not.toMatch(/carousel|reel/);
  });

  it('renders held fact classes with counts and at most 3 examples, skipping empty classes', () => {
    const lines = capabilityLines(undefined, {
      classes: [
        { atomClass: 'service', count: 11, examples: ['Pilates Reformer', 'Kinetoterapie', 'Masaj', 'Yoga'] },
        { atomClass: 'policy', count: 0, examples: [] },
      ],
      facets: ['audience: women 30-50 after injury'],
    }).join('\n');
    expect(lines).toContain('- service: 11 (e.g. "Pilates Reformer", "Kinetoterapie", "Masaj")');
    expect(lines).not.toContain('Yoga');
    expect(lines).not.toContain('policy');
    expect(lines).toContain('Understanding BB holds: audience: women 30-50 after injury');
  });

  it('sends the capability + holdings sections to the model in the user message', async () => {
    const m = new AnthropicPlanModel('test-key');
    const call = vi.fn().mockResolvedValue({ monthDirection: 'd', currentFocusIndex: 0, notNow: [], priorities: [] });
    (m as any).call = call;
    await m.draftPlan({ strategy: STRATEGY, envelope: ENVELOPE, businessName: 'B', heldFacts: { classes: [{ atomClass: 'location', count: 2, examples: ['Str. Exemplu 1'] }], facets: [] } });
    const user = call.mock.calls[0]![1] as string;
    expect(user).toContain('WHAT BB CAN DO');
    expect(user).toContain('WHAT BB ALREADY HOLDS');
    expect(user).toContain('- location: 2 (e.g. "Str. Exemplu 1")');
  });
});
