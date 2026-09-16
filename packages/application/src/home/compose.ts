import type { HomeAction, HomeBriefing, HomeBriefingInput, HomeLine } from './contracts';

const clip = (s: string, n: number): string => {
  const t = (s ?? '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n); const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[.,;:\s]+$/, '')}…`;
};

const dayOfBet = (nowIso: string, adoptedAt: string): number => {
  const ms = new Date(nowIso).getTime() - new Date(adoptedAt).getTime();
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
};

const TALK: HomeAction = { kind: 'talk', labelKey: 'home.act.talk', to: null };
const why = (to: string | null): HomeAction => ({ kind: 'why', labelKey: 'home.act.why', to });

/**
 * Compose the strategist's home briefing from held state. Pure and total — deterministic given the input, so
 * both the message (which line keys, in what order) and the three-action selection are unit-testable. The
 * first action is always "do the work" for wherever the founder is; the second is always Talk; the third is
 * always "show me why".
 */
export function composeHomeBriefing(input: HomeBriefingInput): HomeBriefing {
  const name = input.businessName;

  // Before BB has read anything → the pour-in (empty) phase. Block 2 renders the sources surface.
  if (!input.understandingPresent) {
    return { phase: 'empty', context: { name, day: null, bet: null }, lines: [], actions: [] };
  }

  const adopted = Boolean(input.strategy?.adoptedAt && input.strategy?.bet?.trim());

  // Understanding held, but no strategic bet decided yet → orient toward the decision.
  if (!adopted) {
    return {
      phase: 'briefing',
      context: { name, day: null, bet: null },
      lines: [
        { key: 'home.line.read' },
        { key: 'home.line.needBet' },
        { key: 'home.line.canPropose' },
      ],
      actions: [
        { kind: 'do', labelKey: 'home.act.seeStrategy', to: '/strategy' },
        TALK,
        why('/strategy'),
      ],
    };
  }

  const bet = clip(input.strategy!.bet, 72);
  const day = dayOfBet(input.now, input.strategy!.adoptedAt!);
  const lines: HomeLine[] = [{ key: 'home.line.bet', vars: { bet } }];
  if (input.changeLine) lines.push(input.changeLine);

  let actions: HomeAction[];
  if (input.today.state === 'active' && input.today.move) {
    const move = input.today.move;
    lines.push({ key: 'home.line.today', vars: { move: clip(move.what, 140) } });
    lines.push({ key: move.canCreate ? 'home.line.canDraft' : 'home.line.canWork' });
    lines.push({ key: 'home.line.ask' });
    const doAction: HomeAction = move.canCreate
      ? { kind: 'do', labelKey: 'home.act.draft', to: '/create' }
      : { kind: 'do', labelKey: 'home.act.work', to: null }; // BB works it through with the founder (Talk)
    actions = [doAction, TALK, why('/today')];
  } else if (input.today.blocked) {
    lines.push({ key: 'home.line.blocked', vars: { blocked: clip(input.today.blocked.what, 140) } });
    lines.push({ key: 'home.line.ask' });
    actions = [{ kind: 'do', labelKey: 'home.act.resolve', to: '/today' }, TALK, why('/today')];
  } else {
    // adopted, nothing ready and nothing blocked → shape the week's moves
    lines.push({ key: 'home.line.shapeWeek' });
    lines.push({ key: 'home.line.ask' });
    actions = [{ kind: 'do', labelKey: 'home.act.shape', to: '/today' }, TALK, why('/today')];
  }

  return { phase: 'briefing', context: { name, day, bet }, lines, actions };
}
