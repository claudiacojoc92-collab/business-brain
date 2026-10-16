import { describe, it, expect } from 'vitest';
import { readRules, readUserBlock } from './anthropic-mirror.model';

// UPDATED READ prompt (2026-10-16): the model sees the prior read, the questions, the paired answers and the goal.
describe('updated read prompt', () => {
  const block = readUserBlock({
    businessName: 'Northside', interfaceLanguage: 'en', synthesis: 'Classes from the timetable; physio after a paid assessment.',
    hypotheses: [{ interpretation: 'The studios may play different roles.', evidence: ['Services: Physio'], alternative: 'Space or staffing.', unknown: 'Why physio is not at Riverside.', question: 'Is physio offered at Riverside?', reversal: 'Physio by appointment at Riverside.' }],
    questions: ['Which lines bring the most clients?'], exchanges: [{ asked: 'Which lines bring the most clients?', answer: 'Pilates and massage.' }],
    goal: 'Grow clients', observed: ['Two studios'], business: ['Referrals bring most clients'],
  });

  it('labels every grounding source the fields must cite', () => {
    for (const x of ['S — THE STRUCTURAL READ', 'H0: The studios may play different roles.', 'evidence: "Services: Physio"', 'what else could explain it: Space or staffing.',
      'the question that decides it: Is physio offered at Riverside?', 'what would weaken or reverse it:', 'A0: asked: Which lines bring the most clients?', 'answered: Pilates and massage.',
      "G — THE FOUNDER'S GOAL: Grow clients", 'O1: Two studios', 'F1: Referrals bring most clients']) expect(block).toContain(x);
  });

  it('asks for consequences, change only when it happened, and never names a real test business', () => {
    const rules = readRules('Romanian');
    expect(rules).toContain('write every "text" in Romanian');
    expect(rules).toMatch(/OMIT it\. Never\s+manufacture\s+change/);
    expect(rules).toContain('never a command to the founder');
    expect(rules).toContain('FACT VERSUS INTERPRETATION');
    expect(rules).toContain('ONE event is evidence worth checking, never a pattern');
    expect(rules).toContain('happens AFTER that step'); // the sharp post-first-step fork
    expect(rules).toContain('FACT SYNTHESIS ONLY'); // now = grounded facts; judgement lives in next
    expect(rules).toContain('FACT SYNTHESIS RULE: never add an attribute');
    expect(rules).toContain('the next constraint to investigate');
    expect(rules).toContain('a logical');
    expect(rules).toContain('explain the CONSEQUENCE');
    expect(rules).not.toMatch(/Body Move|Decebal|Bună Ziua|kineto/i);
  });
});
