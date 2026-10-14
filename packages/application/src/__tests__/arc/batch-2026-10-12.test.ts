import { describe, it, expect } from 'vitest';
import { guardAnswers, projectContainer, containerKey } from '../../arc/container';
import { isOutcomeGoal, isHeldGoal } from '../../conversation/goal-candidate';
import { siteGapIrrelevant, isQuestion } from '../../mirror/mirror.service';
import { composeHomeBriefing } from '../../home/compose';
import { spokenView } from '../../arc/spoken-view';

// Cases are the founder's real QuFi sentences from the 2026-10-12 prod walk.
const said = [
  'The testnet is the blocker. The audit can be scheduled in parallel; the named engineer is just an assignment. We have the testnet in development but not ready for external use.',
  'A mid-tier European bank already in our network of conversations. They would need a security audit, a testnet integration they can run themselves, and a named engineer.',
  'Two active pipeline organisations have asked twice for the testnet date and are waiting on it.',
];
const questions = [
  'What is the current state of the network: is any part of QuFi live, in testnet, or still in design?',
  'Who is the actual first buyer or integration partner?',
  'What is the revenue model: node fees, enterprise licences, a token, API pricing, or something else?',
];

describe('container reflects what the founder said (item 3)', () => {
  it('keeps an answer only when its words come from what the founder said', () => {
    const kept = guardAnswers([
      { index: 0, answer: 'You have the testnet in development, not ready for external use.' },
      { index: 1, answer: 'Your first buyer is a mid-tier European bank already in conversation with you.' },
      { index: 2, answer: 'You charge enterprise licences with annual subscription pricing tiers.' }, // never said
      { index: 7, answer: 'out of range' },
    ], questions, said);
    expect(kept.map((a) => a.index)).toEqual([0, 1]);
  });
  it('shows the goal and answers as "declared", and only the unanswered question as unknown', () => {
    const items = projectContainer(null, [{ kind: 'goal', statement: 'Signed pilot with the bank in 60 days.', status: 'active' }, { kind: 'constraint', statement: 'Environment setup is manual today.', status: 'active' }],
      questions, [{ index: 0, answer: 'You have the testnet in development.' }, { index: 1, answer: 'Your first buyer is a mid-tier European bank.' }]);
    expect(items.filter((i) => i.provenance === 'declared').map((i) => i.labelKey)).toEqual(['arc.container.lbl.goal', 'arc.container.lbl.told', 'arc.container.lbl.told', 'arc.container.lbl.constraint']);
    expect(items.filter((i) => i.provenance === 'unknown').map((i) => i.statement)).toEqual([questions[2]]);
  });
  it('re-judges when the founder says something new', () => {
    expect(containerKey(questions, said)).not.toBe(containerKey(questions, [...said, 'We charge per verification.']));
  });
});

describe('goal is an outcome, not a condition (item 4)', () => {
  it('rejects the condition that was offered on QuFi, accepts the goal the founder wrote', () => {
    expect(isOutcomeGoal('The bank\'s security team must be able to run an end-to-end verification without QuFi engineers present, and that is the definition of passing the testnet milestone.')).toBe(false);
    expect(isOutcomeGoal('Environment setup is manual today and needs to be tightened before a bank\'s team can run solo')).toBe(false);
    expect(isOutcomeGoal('Signed pilot with the bank in 60 days.')).toBe(true);
    expect(isOutcomeGoal('Fill the clinic by spring')).toBe(true);
    // run 2 of the local QuFi flow: a delivery milestone, not the goal (the founder's goal was the signed pilot)
    expect(isOutcomeGoal('Pass the bank security team test: they reproduce a signed proof on their own infrastructure without our engineers on the call.')).toBe(false);
    expect(isOutcomeGoal('Pass an end-to-end verification test run by a bank\'s security team, unassisted, on their own infrastructure, within 60 days.')).toBe(false);
    expect(isOutcomeGoal('Grow memberships')).toBe(true);
    // the held goal: a classifier-filed milestone never counts; the founder's own confirmed goal always does
    expect(isHeldGoal({ kind: 'goal', statement: 'Pass the bank security team test: they reproduce a signed proof.', sourceTurnId: 'turn1' })).toBe(false);
    expect(isHeldGoal({ kind: 'goal', statement: 'Signed pilot with the bank in 60 days.', sourceTurnId: 'turn1' })).toBe(true);
    expect(isHeldGoal({ kind: 'goal', statement: 'Make the testnet runnable without us.', sourceTurnId: null })).toBe(true);
  });
});

describe('mirror: the site is one channel (item 5)', () => {
  it('drops a missing-site-path contrast when the founder sells through relationships', () => {
    expect(siteGapIrrelevant('No contact form, no sign-up, no waitlist, no sales enquiry path is visible on any page.', said)).toBe(true);
    expect(siteGapIrrelevant('No contact form, no sign-up, no waitlist, no sales enquiry path is visible on any page.', ['We sell memberships to people who find us online.'])).toBe(false);
    expect(siteGapIrrelevant('The site gives six categories equal weight.', said)).toBe(false);
    // run 2: an open unknown was used as the "I saw" side
    expect(isQuestion('Which of QuVault, QuSettle and QuFi Verify is the one you are selling first, and to which specific buyer type?')).toBe(true);
    expect(isQuestion("'200+ organisations in pipeline', observed as a stated pipeline figure on the site")).toBe(false);
  });
});

describe('Today: whole sentences, one voice (item 1)', () => {
  it('never cuts the bet or the move, cleans dashes and manager verbs', () => {
    const bet = 'Make the testnet runnable by the bank\'s security team without your engineers, then put that milestone in front of the two organisations that have already asked twice.';
    const move = 'Identify every step in the current environment setup that requires a QuFi engineer to intervene — commands that fail silently, dependencies that are not documented, configuration values that live only in someone\'s head.';
    const b = composeHomeBriefing({ businessName: 'QuFi', now: '2026-10-14T12:00:00.000Z', understandingPresent: true, strategy: { bet, adoptedAt: '2026-10-12T12:00:00.000Z' }, today: { state: 'active', move: { what: move, canCreate: false }, blocked: null }, changeLine: null, cycleClose: null });
    const betLine = b.lines.find((l) => l.key === 'home.line.bet')!.vars!.bet!;
    const todayLine = b.lines.find((l) => l.key === 'home.line.today')!.vars!.move!;
    expect(betLine).toBe(bet);
    expect(todayLine).toBe('Find every step in the current environment setup that requires a QuFi engineer to intervene: commands that fail silently, dependencies that are not documented, configuration values that live only in someone\'s head.');
    expect(`${betLine}${todayLine}`).not.toMatch(/…|—/);
  });
});

describe('one voice at the arc exit point (item 2)', () => {
  it('cleans BB text, never the founder\'s words', () => {
    const v = spokenView({ moment: 'mirror', businessName: 'QuFi', mirror: { founderWords: 'Signed pilot — 60 days', against: 'The site — no path', tension: 'You want a pilot — the site has no path.' } });
    expect(v.mirror).toEqual({ founderWords: 'Signed pilot — 60 days', against: 'The site, no path', tension: 'You want a pilot, the site has no path.' });
  });
});

describe('container audience line (2026-10-14)', () => {
  const u = (audience: Record<string, unknown>) => ({ offer: { summary: '' }, positioning: { summary: '' }, audience } as unknown as Parameters<typeof projectContainer>[0]);
  it('uses the composed audience.summary (content language) when present', () => {
    const items = projectContainer(u({ summary: 'Privatpersonen ohne Trading-Erfahrung', addressed: ['People with no trading experience'] }), [], [], []);
    expect(items.find((x) => x.labelKey === 'arc.container.lbl.audience')?.statement).toBe('Privatpersonen ohne Trading-Erfahrung');
  });
  it('falls back to the lifted addressed lines for an older understanding', () => {
    const items = projectContainer(u({ addressed: ['Post-op patients', 'Athletes'] }), [], [], []);
    expect(items.find((x) => x.labelKey === 'arc.container.lbl.audience')?.statement).toBe('Post-op patients, Athletes');
  });
});
