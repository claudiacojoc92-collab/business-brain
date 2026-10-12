import { describe, it, expect } from 'vitest';
import { spoken, plainSubject, VOICE_RULES } from '../../arc/spoken-voice';

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
});
