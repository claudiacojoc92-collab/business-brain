import { describe, it, expect } from 'vitest';
import { guardWeekStory, fallbackStory, fit, admit, sourceText, jargonIn, storyJargon } from '../../arc/week-story';
import type { WeekStoryInput } from '../../arc/contracts';

const input: WeekStoryInput = {
  businessName: 'QuFi Network', language: 'en',
  goal: 'Get one bank across the line into a signed pilot in the next six months.',
  horizon: 'Six months, focused on converting one of the two banks already in active pilot discussions.',
  bet: 'Get third-party cryptographic validation done so the closer bank can take QuFi Verify to procurement.',
  monthDirection: 'This month the validation stops being an intention and becomes a scoped engagement. The rest waits.',
  priorities: [
    { title: 'Scope the third-party validation with an audit firm', why: 'The closer bank named validation as its one condition. Nothing else moves procurement.' },
    { title: 'Write the pilot perimeter for QuFi Verify', why: 'Procurement needs a defined perimeter it can say yes to.' },
    { title: 'Share the validation plan with the closer bank', why: 'Making it visible turns the task into a deal-closer and builds credibility.' },
  ],
  moves: [
    { what: 'Identify every step in the current testnet environment setup that requires manual engineer intervention.', why: 'The audit firm will need to run the protocol without you in the room.' },
    { what: 'Define the precise scope of the audit around QuFi Verify on the private testnet.', why: 'A firm can only quote a defined scope.' },
    { what: 'Reach out to the shortlisted firm and move to a signed engagement letter.', why: 'The bank needs a dated commitment, not an intention.' },
  ],
  today: {
    what: 'Identify every step in the current testnet environment setup that requires manual engineer intervention.',
    why: 'The audit firm will need to run the protocol without you in the room.',
    done: 'A written list of every place an engineer has to intervene, with what they do at each.',
  },
};

const good = {
  context: 'Week 1 of your six-month push to a signed bank pilot.',
  statement: 'The validation becomes real this week.',
  whyNow: 'The closer bank named one condition. Everything else can wait.',
  chapters: [
    { title: 'Scope the validation with an audit firm', why: 'It is the one condition the closer bank named.' },
    { title: 'Draw the pilot perimeter', why: 'Procurement says yes to something bounded.' },
    { title: 'Show the bank the plan', why: 'Visible validation turns a task into credibility.' },
  ],
  today: { move: 'Find every silent dependency in the testnet setup.', detail: 'Walk the setup end to end and note each place an engineer steps in.' },
  doneLooksLike: 'A written list of every place an engineer has to intervene.',
};

describe('week story guard (Moment 6 as a chapter)', () => {
  it('keeps a clean model story as written', () => {
    const s = guardWeekStory(good, input, 'pv1');
    expect(s.planVersionId).toBe('pv1');
    expect(s.statement).toBe(good.statement);
    expect(s.chapters.map((c) => c.title)).toEqual(good.chapters.map((c) => c.title));
    expect(s.today.move).toBe(good.today.move);
    expect(s.doneLooksLike).toBe(good.doneLooksLike);
  });

  it('falls back to the plan\'s own wording when the model gives nothing', () => {
    const s = guardWeekStory(null, input, 'pv1');
    expect(s).toEqual(fallbackStory(input, 'pv1'));
    expect(s.context).toBe(''); // the UI shows its own "Week 1" label
    expect(s.chapters).toHaveLength(3);
    expect(s.chapters[0]!.title.startsWith('Identify every step in the current testnet')).toBe(true);
    expect(s.doneLooksLike).toBe(input.today!.done.slice(0, s.doneLooksLike.length));
  });

  it('drops the generic chatbot opener', () => {
    const s = guardWeekStory({ ...good, statement: 'Good. We\'re doing this.' }, input, 'pv1');
    expect(s.statement).toBe(fallbackStory(input, 'pv1').statement);
  });

  it('drops questions, invented numbers and unlicensed claims per field', () => {
    const s = guardWeekStory({
      ...good,
      whyNow: 'Is this the week?',                                     // only a question → nothing left
      statement: 'Ten days to a signed pilot.',                         // fine (no digits)
      context: 'Week 1 of your 60-day sprint to a signed pilot.',       // "60" is not in the plan or strategy ("1" is: Week 1)
      today: { move: good.today.move, detail: 'Unlike competitors, you are unique here.' }, // unlicensed claim terms
    }, input, 'pv1');
    const fb = fallbackStory(input, 'pv1');
    expect(s.whyNow).toBe(fb.whyNow);
    expect(s.context).toBe('');
    expect(s.today.detail).toBe(fb.today.detail);
    expect(s.statement).toBe('Ten days to a signed pilot.');
  });

  it('allows a claim term the plan already uses ("credibility")', () => {
    expect(admit('Visible validation builds credibility.', 150, sourceText(input))).toBe('Visible validation builds credibility.');
  });

  it('licenses a word family, not new claims ("credible" ok when the plan says "credibility"; "trust" still not)', () => {
    expect(admit('Name the credible firms.', 150, sourceText(input))).toBe('Name the credible firms.');
    expect(admit('Earn the bank\'s trust.', 150, sourceText(input))).toBe('');
  });

  it('keeps "Week 1" in the context line (the week number is licensed)', () => {
    expect(guardWeekStory(good, input, 'pv1').context).toBe(good.context);
  });

  it('never adds, drops or reorders a beat: one chapter per plan move', () => {
    const extra = guardWeekStory({ ...good, chapters: [...good.chapters, { title: 'Launch a campaign', why: 'Reach.' }] }, input, 'pv1');
    expect(extra.chapters).toHaveLength(3);
    const short = guardWeekStory({ ...good, chapters: [good.chapters[0]!] }, input, 'pv1');
    expect(short.chapters).toHaveLength(3);
    expect(short.chapters[1]!.title).toBe(input.moves[1]!.what);
  });

  it('fits long text to its first sentence and never cuts one (no "…")', () => {
    expect(fit('Short one. And a much longer second sentence that goes on.', 20)).toBe('Short one.');
    const long = 'A first sentence that runs well past the cap but is never cut in the middle. Then more.';
    expect(fit(long, 20)).toBe('A first sentence that runs well past the cap but is never cut in the middle.');
    expect(fit(long, 20)).not.toMatch(/…/);
  });


  it('catches consultant phrasing the founder flagged, not ordinary words', () => {
    expect(jargonIn('Name the firms whose credibility moves committees')).toEqual(['credibility moves committees']);
    expect(jargonIn('the validated perimeter matches what they sign')).toEqual(['perimeter', 'validated perimeter']);
    expect(jargonIn('Pick the audit firm the bank already trusts.')).toEqual([]);
    expect(storyJargon({ statement: 'Fine.', chapters: [{ title: 'Align stakeholders', why: 'ok' }] })).toEqual(['stakeholders']);
  });
});
