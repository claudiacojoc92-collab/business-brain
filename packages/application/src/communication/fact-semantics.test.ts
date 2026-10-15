import { describe, it, expect } from 'vitest';
import { checkCountedFacts, heldCountedClauses } from './fact-semantics';

// Acceptance 2026-10-14: Email C passed "lucrez cu 2 medici care trimit pacienți" from "2 medici confirmați, unul a trimis 3 paciente".
const HELD = ['2 medici confirmați, unul a trimis 3 paciente'];
const fails = (msg: string, held = HELD) => checkCountedFacts(msg, held).length > 0;

describe('counted facts keep subject / quantity / action / outcome', () => {
  it('parses the held fact into two clauses: 2 × confirmed; 1 × sent 3 patients', () => {
    const c = heldCountedClauses(HELD);
    expect(c.map((x) => [x.quantity, x.subject, [...x.actions], [...x.objects]])).toEqual([
      [2, 'medic', ['confi'], []],
      [1, 'medic', ['trimi'], [['pacie', 3]]], // action keys: prefix-compared
    ]);
  });

  it('meaning-preserving claims pass', () => {
    expect(fails('Avem 2 medici confirmați.')).toBe(false);
    expect(fails('Un medic a trimis deja 3 paciente.')).toBe(false);
    expect(fails('Un medic ne-a trimis deja paciente.')).toBe(false);        // says less
    expect(fails('Doi medici confirmați; unul dintre ei a trimis 3 paciente.')).toBe(false);
  });

  it('the action of one attached to two fails (the Email C sentence)', () => {
    expect(fails('Conduc Body Move Studio și lucrez cu 2 medici care trimit pacienți la kinetoterapie.')).toBe(true);
    expect(fails('2 medici trimit pacienți.')).toBe(true);
    expect(fails('Doi medici ne trimit deja paciente.')).toBe(true);
  });

  it('a new action attached to a stated number fails; neutral context (the place) does not', () => {
    expect(fails('Doi medici ne recomandă deja pacientelor lor.')).toBe(true);
    expect(fails('Avem 2 medici confirmați.')).toBe(false);
    expect(checkCountedFacts('Avem 2 medici confirmați în Cluj-Napoca.', HELD, 'Kinetoterapie, în două locații din Cluj-Napoca')).toEqual([]);
  });

  it('a trait the held fact does not give the referrer fails (the recipient\'s specialty is not neutral)', () => {
    expect(checkCountedFacts('Un alt medic ortoped ne-a trimis deja 3 paciente.', HELD, 'Kinetoterapie, Body Move Studio')).toHaveLength(1);
    expect(checkCountedFacts('Un alt medic ne-a trimis deja 3 paciente.', HELD, 'Kinetoterapie, Body Move Studio')).toEqual([]);
  });

  it('a dropped quantity (generalisation) or a changed outcome fails', () => {
    expect(fails('Medicii ne trimit constant pacienți.')).toBe(true);
    expect(fails('Un medic a trimis 5 paciente.')).toBe(true);
    expect(fails('3 medici sunt confirmați.')).toBe(true);
  });

  it('mentions of the same noun that are not counted claims are left alone', () => {
    expect(fails('Ca medic ortoped, vedeți pacienți după operații.')).toBe(false);
    expect(fails('Pacienții care au nevoie de kinetoterapie după consultație.')).toBe(false);
  });

  it('generic across languages (en)', () => {
    const en = ['2 doctors confirmed, one sent 3 patients'];
    expect(fails('We have 2 confirmed doctors.', en)).toBe(false);
    expect(fails('One doctor has already sent 3 patients.', en)).toBe(false);
    expect(fails('I work with 2 doctors who send patients.', en)).toBe(true);
    expect(fails('Doctors send us patients regularly.', en)).toBe(true);
  });
});
