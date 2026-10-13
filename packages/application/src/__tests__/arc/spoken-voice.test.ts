import { describe, it, expect } from 'vitest';
import { spoken, plainSubject, VOICE_RULES } from '../../arc/spoken-voice';
import { spokenView } from '../../arc/spoken-view';
import type { ArcView } from '../../arc/contracts';

describe('spoken voice cleanup (shared by week story + email)', () => {
  it('turns dashes between words into commas', () => {
    expect(spoken('the runbook — scheduling the session')).toBe('the runbook, scheduling the session');
    expect(spoken('thank you for your patience — and for asking twice.')).toBe('thank you for your patience, and for asking twice.');
    expect(spoken('a well-known, self-service setup')).toBe('a well-known, self-service setup'); // real hyphens stay
    // bullets stay bullets (the first version collapsed "\n- item" lists into commas)
    expect(spoken('You will receive:\n- A runbook — no engineer needed\n- A pass/fail criterion')).toBe('You will receive:\n- A runbook, no engineer needed\n- A pass/fail criterion');
    expect(spoken('Next:\n— Book the session')).toBe('Next:\n- Book the session');
  });
  it('cuts an explained placeholder to its first phrase', () => {
    expect(spoken('on [specific date — to be confirmed by end of this week].')).toBe('on [specific date].');
    expect(spoken('Hi [Name],')).toBe('Hi [Name],');
    expect(spoken('[criterion, e.g. "all transactions complete within the defined latency threshold with no key material leaving your infrastructure"].')).toBe('[criterion].');
  });
  it('writes "and" instead of "+" in a subject, in the content language', () => {
    expect(plainSubject('QuFi testnet date + runbook', 'en')).toBe('QuFi testnet date and runbook');
    expect(plainSubject('Data + ghidul', 'ro')).toBe('Data și ghidul');
  });

  it('a dash that introduces a list becomes a colon (BUS-69), a single clause still a comma', () => {
    expect(spoken('every step that requires us to intervene — commands that fail silently, dependencies that are not written down, values that live in someone\'s head.'))
      .toBe('every step that requires us to intervene: commands that fail silently, dependencies that are not written down, values that live in someone\'s head.');
    expect(spoken('Thank you for your patience — and for asking twice.')).toBe('Thank you for your patience, and for asking twice.');
  });
  it('plain verbs, never inside quotes', () => {
    expect(spoken('Identify every step that needs an engineer, and ensure each one is fixed.')).toBe('Find every step that needs an engineer, and make sure each one is fixed.');
    expect(spoken('a short call to align on your infrastructure')).toBe('a short call to go over your infrastructure');
    expect(spoken('Your site says "Identify — verify — settle".')).toBe('Your site says "Identify — verify — settle".');
  });
  it('the shared prompt block names the rules and no real business', () => {
    expect(VOICE_RULES).toMatch(/NO DASHES/);
    expect(VOICE_RULES).not.toMatch(/qufi|testnet|body move|bank/i);
  });
  it('collapses punctuation doubled where fragments were joined (".;", "..", ",."); an ellipsis stays', () => {
    expect(spoken('Your numbers are targets and goals, not actuals.; no bank has signed')).toBe('Your numbers are targets and goals, not actuals; no bank has signed');
    expect(spoken('Pilots are planned, confirming these have not yet happened..')).toBe('Pilots are planned, confirming these have not yet happened.');
    expect(spoken('one bank, two pilots,.')).toBe('one bank, two pilots.');
    expect(spoken('Wait for it...')).toBe('Wait for it...');
  });
  it('lowercases a common opening word after a semicolon; a name stays as written', () => {
    expect(spoken('targets, not actuals; No named customer; The three products')).toBe('targets, not actuals; no named customer; the three products');
    expect(spoken('no pricing; QuVault has no page; Bucharest is next')).toBe('no pricing; QuVault has no page; Bucharest is next');
    expect(spoken('one pilot; I asked twice')).toBe('one pilot; I asked twice');
  });
  it('stage evidence goes through the cleaner and loses its own closing punctuation (the card joins it into one sentence)', () => {
    const v = spokenView({ understanding: { does: '', serves: '', standsOut: '', tensions: [], confident: [], inferring: [], unanswered: [],
      constraint: { decided: true, text: 'No bank has signed yet..' },
      stage: { stage: 'validating', evidence: ['targets and goals, not actuals.', 'these have not yet happened..'], secondary: null } } } as unknown as ArcView);
    const st = v.understanding!.stage as { evidence: string[] };
    expect(st.evidence).toEqual(['targets and goals, not actuals', 'these have not yet happened']);
    expect((v.understanding!.constraint as { text: string }).text).toBe('No bank has signed yet.');
  });
});
