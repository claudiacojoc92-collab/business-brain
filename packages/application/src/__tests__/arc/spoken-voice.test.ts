import { describe, it, expect } from 'vitest';
import { spoken, plainSubject } from '../../arc/spoken-voice';

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
});
