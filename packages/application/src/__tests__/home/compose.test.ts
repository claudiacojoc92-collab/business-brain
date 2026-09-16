import { describe, it, expect } from 'vitest';
import { composeHomeBriefing, type HomeBriefingInput } from '../../home/index';

const base: HomeBriefingInput = {
  businessName: 'Body Move',
  now: '2026-09-16T12:00:00.000Z',
  understandingPresent: true,
  strategy: null,
  today: { state: 'none', move: null, blocked: null },
  changeLine: null,
};

const keys = (b: ReturnType<typeof composeHomeBriefing>): string[] => b.lines.map((l) => l.key);

describe('composeHomeBriefing — the strategist speaks first, from held state', () => {
  it('empty phase before BB has read anything (no message, no actions)', () => {
    const b = composeHomeBriefing({ ...base, understandingPresent: false });
    expect(b.phase).toBe('empty');
    expect(b.lines).toEqual([]);
    expect(b.actions).toEqual([]);
  });

  it('understanding held but no bet → orient toward the decision; first action = see the strategy', () => {
    const b = composeHomeBriefing(base);
    expect(b.phase).toBe('briefing');
    expect(b.context.bet).toBeNull();
    expect(keys(b)).toEqual(['home.line.read', 'home.line.needBet', 'home.line.canPropose']);
    expect(b.actions.map((a) => a.kind)).toEqual(['do', 'talk', 'why']);
    expect(b.actions[0]!.to).toBe('/strategy');
  });

  it('adopted bet + a create move → "Day N", draft action, and the ask line', () => {
    const b = composeHomeBriefing({
      ...base,
      strategy: { bet: 'The referral channel', adoptedAt: '2026-09-14T12:00:00.000Z' },
      today: { state: 'active', move: { what: 'Design the outreach carousel', canCreate: true }, blocked: null },
    });
    expect(b.context.day).toBe(3);                    // adopted 2 days ago → day 3
    expect(b.context.bet).toBe('The referral channel');
    expect(keys(b)).toEqual(['home.line.bet', 'home.line.today', 'home.line.canDraft', 'home.line.ask']);
    expect(b.actions[0]).toMatchObject({ kind: 'do', labelKey: 'home.act.draft', to: '/create' });
    expect(b.actions[2]).toMatchObject({ kind: 'why', to: '/today' });
  });

  it('adopted + a non-create move → the do action opens Talk (BB works it through), to=null', () => {
    const b = composeHomeBriefing({
      ...base,
      strategy: { bet: 'Referrals', adoptedAt: '2026-09-15T12:00:00.000Z' },
      today: { state: 'active', move: { what: 'Call the warm contact', canCreate: false }, blocked: null },
    });
    expect(keys(b)).toContain('home.line.canWork');
    expect(b.actions[0]).toMatchObject({ kind: 'do', labelKey: 'home.act.work', to: null });
  });

  it('adopted + blocked → resolve action to Today, blocked line', () => {
    const b = composeHomeBriefing({
      ...base,
      strategy: { bet: 'Referrals', adoptedAt: '2026-09-15T12:00:00.000Z' },
      today: { state: 'active', move: null, blocked: { what: 'Confirm the brochure files' } },
    });
    expect(keys(b)).toContain('home.line.blocked');
    expect(b.actions[0]).toMatchObject({ kind: 'do', labelKey: 'home.act.resolve', to: '/today' });
  });

  it('adopted, nothing ready and nothing blocked → shape the week', () => {
    const b = composeHomeBriefing({ ...base, strategy: { bet: 'Referrals', adoptedAt: '2026-09-15T12:00:00.000Z' } });
    expect(keys(b)).toContain('home.line.shapeWeek');
    expect(b.actions[0]!.labelKey).toBe('home.act.shape');
  });

  it('inserts the "what changed" line right after the bet when one is provided (never fabricated)', () => {
    const b = composeHomeBriefing({
      ...base,
      strategy: { bet: 'Referrals', adoptedAt: '2026-09-15T12:00:00.000Z' },
      today: { state: 'active', move: { what: 'x', canCreate: false }, blocked: null },
      changeLine: { key: 'home.line.changed.strategy', vars: { v: '2' } },
    });
    expect(keys(b)[0]).toBe('home.line.bet');
    expect(keys(b)[1]).toBe('home.line.changed.strategy');
  });
});
