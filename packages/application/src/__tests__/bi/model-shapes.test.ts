/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { governUnderstanding, normalizeUnderstandingShapes, objectList, stringList, type GovernedUnderstanding, type PageObservation } from '../../bi/index';
import { ArcService } from '../../arc/index';

/**
 * Prod bug 2026-10-15: "Body Move – Blind Test 2" stored stage.secondary.evidence as a STRING and every view of the
 * business crashed in projectUnderstanding with "(xs ?? []).map is not a function". This is that exact stored snapshot.
 */
const STORED = (JSON.parse(readFileSync(join(__dirname, 'fixtures', 'body-move-blind-2-stored-2026-10-15.json'), 'utf8')) as { understanding: GovernedUnderstanding }).understanding;
const SECONDARY_TEXT = (STORED.stage!.secondary as any).evidence as string;
const page = (ref: string): PageObservation => ({ ref, url: `https://bodymovestudio.ro/${encodeURIComponent(ref)}/`, pageType: 'page', title: null, text: '', lang: 'ro', provenance: 'observed', sourceKind: 'website', discoveredVia: 'link' });
const OBS = ['Locatii - Body Move Studio', 'Programari - Body Move Studio', 'Body Move Studio Bună Ziua - Body Move S', 'Homepage', 'Servicii - Body Move Studio'].map(page);
// The same snapshot once the founder has said how the business is performing: only then can a stage be earned.
const SAID = 'Clasele de dimineață sunt pline de trei luni.';
const OBS_SAID: PageObservation[] = [...OBS, { ...page('Founder note'), provenance: 'declared', sourceKind: 'supplied', text: SAID }];
const PERFORMING = { ...STORED, read: { ...STORED.read!, model: STORED.read!.model.map((d) => (d.dimension === 'performance' ? { ...d, known: [{ text: SAID, basis: 'declared' as const, sourceRefs: ['Founder note'] }] } : d)) } } as GovernedUnderstanding;

describe('model list shapes: the exact production failure', () => {
  it('the fixture really is the malformed shape (a string where a list belongs)', () => {
    expect(typeof SECONDARY_TEXT).toBe('string');
  });

  it('A: governance normalises it before storage: the string becomes a one-item list', () => {
    const g = governUnderstanding(PERFORMING, OBS_SAID);
    expect(g.stage!.secondary!.evidence).toEqual([SECONDARY_TEXT]);
  });

  it('B + C: projectUnderstanding renders the ALREADY-STORED malformed snapshot, no TypeError', () => {
    const arc = new ArcService({} as any) as any;
    let card: any;
    expect(() => { card = arc.projectUnderstanding(STORED, []); }).not.toThrow();
    // Footprint is not stage evidence: the stored "growth" (two locations, a timetable, a team) is not shown.
    expect(card.stage).toEqual({ stage: 'undetermined' });
    expect(card.read.asks.length).toBeGreaterThan(0);
    expect(card.read.structure).toBeUndefined(); // stored before the structure existed: the card keeps the inventory view
  });

  it('D: the evidence appears once, as the whole sentence, never character by character', () => {
    const n = normalizeUnderstandingShapes(STORED);
    expect(n.stage!.secondary!.evidence).toHaveLength(1);
    expect(n.stage!.secondary!.evidence[0]).toBe(SECONDARY_TEXT.trim());
  });

  it('E: null, objects, numbers and lists of non-strings become [] (or keep only the strings)', () => {
    for (const bad of [null, undefined, { a: 1 }, 42, true, '', '   ']) expect(stringList(bad)).toEqual([]);
    expect(stringList(['a', 3, null, ' b ', {}])).toEqual(['a', 'b']);
    expect(objectList({ ref: 'x' })).toEqual([]);
    expect(objectList([{ ref: 'x' }, 'y', null])).toEqual([{ ref: 'x' }]);
    const broken = { ...STORED, stage: { ...STORED.stage!, evidence: null, secondary: { stage: 'validating', area: 'X', evidence: { not: 'a list' } } }, unknowns: 'one question?', contradictions: { not: 'a list' } } as unknown as GovernedUnderstanding;
    const n = normalizeUnderstandingShapes(broken);
    expect(n.stage!.evidence).toEqual([]);
    expect(n.stage!.secondary!.evidence).toEqual([]);
    expect(n.unknowns).toEqual(['one question?']);
    expect(n.contradictions).toEqual([]);
    expect(() => (new ArcService({} as any) as any).projectUnderstanding(broken, [])).not.toThrow();
  });
});

describe('stage evidence obeys numeric grounding (prod: "over 25 services", "8 named specialists")', () => {
  it('ungrounded numeric stage lines are dropped; lines without numbers stay; the stored counts do not survive governance', () => {
    const g = governUnderstanding(PERFORMING, OBS_SAID);
    const lines = g.stage!.evidence;
    expect(lines.join(' ')).not.toMatch(/25 de servicii|8 speciali/);
    expect(lines.every((l) => !/\d/.test(l))).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(2); // two number-free lines remain → the stage stays determined
    expect(g.stage!.stage).toBe('growth');
  });

  it('a numeric stage line survives only when its number is grounded on the page (entity + qualifier), and fewer than two lines → undetermined', () => {
    const text = 'Body Move Studio Bună Ziua\nEchipa noastră\nSpecialiști: 8 terapeuți și antrenori';
    const obs = [{ ...OBS[2]!, text }];
    const base = { stage: 'growth' as const, sourceRefs: ['Body Move Studio Bună Ziua - Body Move S'], secondary: null };
    const grounded = governUnderstanding({ ...STORED, stage: { ...base, evidence: ['Echipa de la Bună Ziua are 8 terapeuți și antrenori.', 'Două locații fizice.'],
      numbers: [{ value: 8, entity: 'Bună Ziua', qualifier: 'Specialiști:', ref: 'Body Move Studio Bună Ziua - Body Move S', quote: 'Specialiști: 8 terapeuți și antrenori' }] } } as GovernedUnderstanding, obs);
    expect(grounded.stage!.evidence).toEqual(['Echipa de la Bună Ziua are 8 terapeuți și antrenori.', 'Două locații fizice.']);
    const ungrounded = governUnderstanding({ ...STORED, stage: { ...base, evidence: ['Peste 25 de servicii cu prețuri publice.', 'Două locații fizice.'] } } as GovernedUnderstanding, obs);
    expect(ungrounded.stage).toMatchObject({ stage: 'undetermined' });
  });
});
