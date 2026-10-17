/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { ConversationService, briefAck, plainAck } from '../../conversation/conversation.service';
import type { ConversationStepOutput } from '../../conversation/contracts';

// AGENDA FIDELITY (2026-10-16): the three questions the understanding card showed are the three the conversation asks,
// in order, word for word; a skip leaves its question unresolved; the goal comes after; the close is one sentence.
const Q = ['Which lines bring the most clients?', 'Where do new clients come from?', 'Is physio also offered at Riverside?'];
const U = { offer: { summary: 'x' }, unknowns: Q };

function harness(steps: Partial<ConversationStepOutput>[]) {
  let session: any = null; const turns: any[] = []; const needs: any[] = []; const state: any[] = [];
  let i = 0;
  const base: ConversationStepOutput = { interpretation: '', nextQuestion: null, readyForAha2: false, declarations: [], businessCorrections: [], observationCandidates: [], answeredNeedKeys: [], newNeeds: [] };
  const svc = new ConversationService({
    conversations: {
      getByBusiness: async () => session, create: async (x: any) => (session = { ...x, status: 'active', currentFocus: null }),
      listTurns: async () => turns, appendTurn: async (t: any) => { turns.push(t); return t; },
      setStatus: async (_: string, status: string, focus: string | null) => { session = { ...session, status, currentFocus: focus }; }, setLanguage: async () => undefined,
    } as any,
    needs: {
      seed: async (_s: string, _b: string, ns: any[]) => { for (const n of ns) if (!needs.some((x) => x.key === n.key)) needs.push({ ...n, open: true }); },
      listOpen: async () => needs.filter((n) => n.open), markAnswered: async (_s: string, keys: string[]) => { for (const n of needs) if (keys.includes(n.key)) n.open = false; },
    } as any,
    state: { append: async (x: any) => { state.push({ status: 'active', ...x }); return x; }, listActive: async () => state } as any,
    observations: { observe: async () => null, listActive: async () => [] } as any,
    model: { step: async () => ({ ...base, ...(steps[i++] ?? {}) }) } as any,
    understanding: { latest: async () => ({ id: 's', understanding: U }) } as any,
    aha1: { latest: async () => null } as any,
    sources: { listForBusiness: async () => [] } as any,
  });
  return { svc, turns, needs, session: () => session };
}

describe('conversation agenda fidelity', () => {
  it('asks the shown questions verbatim and in order, even when the model wants to ask something else (the goal)', async () => {
    const h = harness([
      { opener: { lead: 'I read it all.', bullets: ['a'], notSure: 'n', invitation: 'What brings the most money?' } as any },
      { interpretation: 'So the studios earn differently. What do you want to grow?', nextQuestion: 'What do you want to grow this year?', nextNeedKey: 'goal', answeredNeedKeys: ['site_1', 'site_2', 'site_3'] },
      { interpretation: 'Referrals carry it.', nextQuestion: 'What is your goal?', nextNeedKey: 'goal' },
    ]);
    await h.svc.startOrResume('B', 'F', 'Northside', 'en');
    expect(JSON.parse(h.turns[0].content).__arcOpener.invitation).toBe(Q[0]);
    expect(h.turns[0].infoNeedKey).toBe('site_1');
    await h.svc.submitResponse('B', 'F', 'Northside', 'Pilates and massage at one, training at the other.', 'en');
    // the model's acknowledgement stays (its question sentence does not), then question 2 word for word
    expect(h.turns[2].content).toBe(`So the studios earn differently.\n\n${Q[1]}`);
    expect(h.turns[2].infoNeedKey).toBe('site_2');
    await h.svc.submitResponse('B', 'F', 'Northside', 'Referrals and organic content.', 'en');
    expect(h.turns[4].content).toBe(`Referrals carry it.\n\n${Q[2]}`);
    expect(h.turns[4].infoNeedKey).toBe('site_3');
    expect(h.turns.filter((t) => t.role === 'bb').some((t) => /goal|grow this year/i.test(t.content))).toBe(false);
  });

  it('a skip moves on (the question stays unanswered); after the third answer: one brief acknowledgement, then the goal step', async () => {
    const h = harness([
      { opener: { lead: 'l', bullets: [], notSure: 'n', invitation: 'x' } as any },
      { interpretation: 'Got it.' },
      { interpretation: 'Noted.' },
      { interpretation: 'Sinteza:\n• Two studios, two logics.\n• Referrals carry it.\n\nDiagnostic: a clinical profile it does not activate.' },
    ]);
    await h.svc.startOrResume('B', 'F', 'Northside', 'ro');
    await h.svc.submitResponse('B', 'F', 'Northside', 'a1', 'ro');
    await h.svc.declineCurrentNeed('B'); // the arc route does this on "skip"
    await h.svc.submitResponse('B', 'F', 'Northside', '(skip)', 'ro');
    expect(h.turns[4].content).toBe(Q[2]); // a skip is not an answer: no acknowledgement read into it
    await h.svc.submitResponse('B', 'F', 'Northside', 'a3', 'ro');
    const close = h.turns[h.turns.length - 1];
    expect(close.content).toBe('Mulțumesc, asta îmi completează imaginea.'); // no "Sinteza / Diagnostic" before the updated read
    expect(h.session().currentFocus).toBe('__awaiting_goal__');
  });

  it('an acknowledgement reflects what was said, without judgement, superlative or diagnosis', () => {
    const said = 'massage brings strong revenue in both locations';
    expect(plainAck('So the two places are really two businesses. Massage is probably your most consistent earner.', said, 'en')).toBe('Got it.');
    expect(plainAck('Massage brings strong revenue at both locations. It is probably the most consistent earner.', said, 'en')).toBe('Massage brings strong revenue at both locations.');
    expect(plainAck('', said, 'ro')).toBe('Înțeles.');
    // the Body Move acceptance acknowledgement (2026-10-16): an interpretation dressed as an acknowledgement is refused
    expect(plainAck('Masajul apare puternic în ambele, ceea ce înseamnă că e un motor de venit real, nu un serviciu secundar.', 'fiecare locație aduce venit mare din diferite servicii', 'ro')).toBe('Înțeles.');
  });

  it('briefAck keeps one plain sentence; headers, bullets and questions are not an acknowledgement', () => {
    expect(briefAck('That changes how I see the two studios. What do you want next?', 'en')).toBe('That changes how I see the two studios.');
    expect(briefAck('Synthesis:\n• a\n• b', 'en')).toBe('Thank you, that fills in the picture.');
  });
});
