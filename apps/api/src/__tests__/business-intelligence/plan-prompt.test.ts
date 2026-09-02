import { describe, it, expect } from 'vitest';
import { PLAN_SYSTEM } from '@bb/infrastructure';

describe('Slice 5 — plan model prompt contract', () => {
  const prompt = PLAN_SYSTEM;

  // D — the plan is authored in founder-facing PRIORITY/ACTION/STEP language, and must not label a
  // priority/action a "move" (that word is reserved for the Evidence system). Ordinary verb use is allowed.
  it('D. instructs PRIORITIES/ACTIONS/STEPS and forbids "move" as a planning-object label', () => {
    expect(prompt).toMatch(/PRIORITIES, ACTIONS, and STEPS/);
    expect(prompt).toMatch(/Do NOT label a priority or\s+action a "move"/);
    expect(prompt).toMatch(/1[–-]4 PRIORITIES/);
  });
});
