/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { businessSnapshot } from '../../arc/index';

// BUSINESS SNAPSHOT (2026-10-17). Generic by construction: an invented two-site climbing gym.
const known = (text: string, basis = 'observed') => ({ text, basis });
const U = (o: { model?: any[]; offer?: string; audience?: string; mechanisms?: string[]; websiteNotes?: string[]; positioning?: string } = {}): any => ({
  offer: { summary: o.offer ?? 'You sell bouldering classes, a youth team and private coaching, in two locations in Ridgeport.', explicit: [], unclear: [] },
  positioning: { summary: o.positioning ?? 'The friendliest wall in the region.', evidenceBacked: [], implied: [] },
  audience: { summary: o.audience ?? 'Beginner adults and teenagers, from Ridgeport', addressed: [], appearsTargeted: [], unknown: [] },
  messaging: { recurringThemes: [] }, contradictions: [], acquisition: { visiblePaths: [] }, unknowns: [],
  read: {
    model: o.model ?? [
      { dimension: 'offer', known: [known('Private coaching is not offered at the Harbour location; it is offered at Mill Street.'), known('Two locations in Ridgeport: Harbour (by the station) and Mill Street.'), known('Three locations soon.', 'inferred')], unknown: [] },
    ],
    notConcluding: [], untrusted: [], websiteNotes: o.websiteNotes ?? ['The booking page loads slowly.'], diagnosis: { state: 'not_ready', statement: '', checks: {} },
    questions: [], questionTiers: [], strategyReadiness: { state: 'not_ready', missing: [] },
    structure: { synthesis: '', mechanisms: (o.mechanisms ?? ['group_timetable', 'paid_first_step']).map((kind) => ({ kind })), hypotheses: [] },
  },
});
const REC: any = {
  businessModel: {
    motions: [{ name: 'classes', entry: [], buying: ['booking'], continuation: ['repeat_purchase', 'package'], refs: [] }, { name: 'team', entry: [], buying: [], continuation: ['subscription'], refs: [] }],
    offerRoles: [{ offer: 'Intro Session / Safety Check', role: 'entry', refs: [] }, { offer: 'Youth team', role: 'core', refs: [] }],
    decisionPoints: [],
  },
};
const words = (t: string) => (t.match(/\p{L}+/gu) ?? []).length;

describe('business snapshot: what the business is, before any reading of it', () => {
  it('states the counted location line, what it sells for whom, and how it is bought, from governed facts only', () => {
    const s = businessSnapshot(U(), REC, 'Crux Hall', 'en')!;
    expect(s.text).toBe('Crux Hall has two locations in Ridgeport: Harbour and Mill Street. You sell bouldering classes, a youth team and private coaching, for beginner adults and teenagers. Some services are booked directly, per session, as a package or with a subscription, while others start with a paid first step: Intro Session and Safety Check.');
    expect(s.where).toEqual({ area: 'Ridgeport', locations: 2, names: ['Harbour', 'Mill Street'] });
    expect(s.continuity).toEqual(['sessions', 'package', 'subscription']);
    expect(s.provenance.kind).toBe('observed');
    expect(words(s.text)).toBeLessThanOrEqual(90);
  });

  it('a line that merely mentions a location is not the location line; inferred lines never count', () => {
    const s = businessSnapshot(U({ model: [{ dimension: 'offer', known: [known('Private coaching is not offered at the Harbour location.'), known('Two locations in Ridgeport: A and B.', 'inferred')], unknown: [] }] }), REC, 'Crux Hall', 'en')!;
    expect(s.where).toBeNull();
    expect(s.text).not.toMatch(/Harbour location/);
    expect(s.text.startsWith('You sell bouldering classes')).toBe(true);
  });

  it('never carries positioning, website notes or judgements', () => {
    const s = businessSnapshot(U(), REC, 'Crux Hall', 'en')!;
    expect(s.text).not.toMatch(/friendliest|slowly|booking page/i);
  });

  it('the audience is said once when the offer summary already names it', () => {
    const s = businessSnapshot(U({ offer: 'You sell climbing classes for adults and children' }), REC, 'Crux Hall', 'en')!;
    expect(s.text).toContain('You sell climbing classes for adults and children.');
    expect(s.text).not.toMatch(/children, for/);
  });

  it('localized fixed templates in the content language', () => {
    const s = businessSnapshot(U(), REC, 'Crux Hall', 'ro')!;
    expect(s.text).toMatch(/^Crux Hall are two locations/);
    expect(s.text).toContain('Unele servicii se rezervă direct, per ședință, cu pachet sau cu abonament, iar altele încep cu un prim pas plătit: Intro Session și Safety Check.');
  });

  it('stays within 90 words: the audience clause goes first; too little to say → empty text', () => {
    const long = Array.from({ length: 60 }, (_, i) => `item${String.fromCharCode(97 + (i % 26))}x`).join(', ');
    const s = businessSnapshot(U({ offer: `You sell ${long}` }), REC, 'Crux Hall', 'en')!;
    expect(words(s.text)).toBeLessThanOrEqual(90);
    expect(s.text).not.toMatch(/beginner adults/);
    const thin = businessSnapshot(U({ model: [], offer: '', mechanisms: [] }), null, 'Crux Hall', 'en')!;
    expect(thin.text).toBe('');
    expect(businessSnapshot(null, REC, 'Crux Hall', 'en')).toBeNull();
  });
});
