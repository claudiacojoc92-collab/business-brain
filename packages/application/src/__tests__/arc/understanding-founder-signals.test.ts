import { describe, it, expect } from 'vitest';
import { ArcService } from '../../arc/index';
import { normalizeUnderstandingShapes } from '../../bi/model-shapes';
import type { GovernedUnderstanding } from '../../bi/index';

// FOUNDER VIEW signals (2026-10-16, projection only): picked from governed state, never written. An invented business.
const LOC = { ref: 'Locations', page: 'Locations', quote: 'Services: Classes · Physio · Massage', context: 'Northside Old Town', surface: 'location_page' };
const TEAM = { ref: 'Riverside team', page: 'Riverside', quote: 'Dana Pike Physiotherapist', context: 'Team Riverside', surface: 'team_page' };
const understanding = (over: { structure?: object; questions?: object[]; questionTiers?: object[] } = {}): GovernedUnderstanding => normalizeUnderstandingShapes({
  offer: { summary: 'You sell classes, physio and massage in two places.' },
  // the stored question order (the card asks these, in this order)
  unknowns: [
    'Which lines bring the most active clients and the most monthly revenue? a) clients b) revenue',
    'Where do new clients come from today?',
    'Is physio also offered at Riverside, and why or why not?',
  ],
  read: {
    model: [], notConcluding: [], untrusted: [], websiteNotes: [], diagnosis: { state: 'not_ready', statement: '', checks: {} },
    questions: over.questions ?? [
      { question: 'Which lines bring the most active clients and the most monthly revenue? a) clients b) revenue', why: 'Which engine carries it.', dimension: 'performance', parts: ['active clients per line', 'monthly revenue per line'], changes: ['bet'] },
      { question: 'Where do new clients come from today?', why: 'Whether acquisition is scattered and unpredictable.', dimension: 'acquisition', changes: ['channel'] },
      { question: 'Is physio also offered at Riverside, and why or why not?', why: 'Whether the places play different roles.', dimension: 'capacity', changes: ['offer'] },
    ],
    questionTiers: over.questionTiers ?? [
      { question: 'Which lines bring the most active clients and the most monthly revenue? a) clients b) revenue', tier: 'A', reason: 'strategy-critical for readiness: performance is unknown' },
      { question: 'Where do new clients come from today?', tier: 'A', reason: 'strategy-critical for readiness: acquisition is unknown' },
      { question: 'Is physio also offered at Riverside, and why or why not?', tier: 'B', reason: 'settles hypothesis 1', resolves: 0 },
    ],
    structure: over.structure ?? {
      synthesis: 'Not every service is entered the same way: classes are booked from the timetable, while physio starts with a paid assessment. The two places do not offer the same things: physio is listed at Old Town but not at Riverside. I do not yet know whether that is deliberate.',
      mechanisms: [{ kind: 'group_timetable', ref: 'Timetable' }, { kind: 'paid_first_step', ref: 'Physio' }, { kind: 'packages', ref: 'Prices' }],
      hypotheses: [{
        pattern: 'Physio is listed at Old Town. The Riverside team lists Dana Pike as a physiotherapist, with no physio on its timetable.',
        interpretation: 'The two places may play different roles. Riverside may have idle capacity.', whyItMatters: '', alternative: 'Space, equipment or staffing.', reversal: 'Physio by appointment at Riverside.',
        relationship: 'divergence', between: ['Northside Riverside', 'Northside Old Town'], dimensions: ['offer', 'capacity'], changes: ['offer'],
        discriminator: { unknown: 'Why physio is not at Riverside.', question: '' }, evidence: [LOC, TEAM],
      }],
    },
  },
} as unknown as GovernedUnderstanding);
const read = (u: GovernedUnderstanding) => (new ArcService({} as never) as unknown as { projectUnderstanding: (u: GovernedUnderstanding, f: unknown[]) => { read: { asks: { question: string; tier?: string; dimension?: string; resolves?: number; parts?: string[] }[]; structure: { founder: Record<string, unknown> } } } }).projectUnderstanding(u, []).read;

describe('founder view signals (projection only)', () => {
  it('picks the places, the routes clause and the location facts from governed state', () => {
    const f = read(understanding()).structure.founder;
    expect(f['mechanisms']).toEqual(['group_timetable', 'paid_first_step', 'packages']);
    expect(f['places']).toEqual(['Riverside', 'Old Town']); // the shared brand is dropped
    expect(f['placeHypothesis']).toBe(0);
    expect(f['routes']).toBe('classes are booked from the timetable, while physio starts with a paid assessment.');
    expect(f['placeFacts']).toEqual([
      'Physio is listed at Old Town but not at Riverside.', // the synthesis sentence about both places, without its lead-in
      'The Riverside team lists Dana Pike as a physiotherapist, with no physio on its timetable.', // the pattern sentence carrying the team evidence
    ]);
    // the team / public-offer gap: role from the team page, listed at the other place only, the synthesis's word for the service
    expect(f['placeTeam']).toEqual({ place: 'Riverside', role: 'physiotherapist', service: 'physio' });
  });

  it('never projects the hypothesis sentence that judges capacity, nor the synthesis unknown', () => {
    const f = JSON.stringify(read(understanding()).structure.founder);
    expect(f).not.toMatch(/idle capacity|do not yet know/);
  });

  it('each shown question carries its tier, dimension and the hypothesis it settles; an inline a)/b) duplicate of its parts is removed', () => {
    const asks = read(understanding()).asks;
    expect(asks.map((a) => [a.tier, a.dimension, a.resolves])).toEqual([['A', 'performance', undefined], ['A', 'acquisition', undefined], ['B', 'capacity', 0]]);
    expect(asks[0]!.question).toBe('Which lines bring the most active clients and the most monthly revenue?');
    expect(asks[0]!.parts).toEqual(['active clients per line', 'monthly revenue per line']);
  });

  it('no location page → no places; fewer than two mechanisms → no routes clause', () => {
    const f = read(understanding({ structure: {
      synthesis: 'Classes are the core: they are booked from the timetable. I do not yet know more.',
      mechanisms: [{ kind: 'group_timetable', ref: 'Timetable' }],
      hypotheses: [{ pattern: 'x.', interpretation: 'Two teachers may split the week.', whyItMatters: '', alternative: 'Availability.', reversal: 'y.', relationship: 'divergence', between: ['Ana', 'Ben'], dimensions: ['offer', 'capacity'], changes: ['offer'], discriminator: { unknown: 'u', question: '' }, evidence: [TEAM, { ...TEAM, quote: 'Ben Lee Teacher' }] }],
    } })).structure.founder;
    expect(f['places']).toBeUndefined();
    expect(f['routes']).toBeUndefined();
    expect(f['placeFacts']).toBeUndefined();
    expect(f['placeTeam']).toBeUndefined();
  });
});
