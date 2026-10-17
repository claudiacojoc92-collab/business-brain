import type { ArcView } from './contracts';
import { spoken } from './spoken-voice';

/**
 * The deterministic half of the ONE voice, applied to every BB-AUTHORED field of the arc view at the single exit
 * point (ArcService.view). Founder words are never rewritten: the goal candidate, the mirror's "you said", the
 * "because you said" note, declared container items, and founder turns.
 */
const s = (x: string | null | undefined): string => (typeof x === 'string' ? spoken(x) : (x as unknown as string));
const ss = (xs: readonly string[] | undefined): string[] | undefined => (xs ? xs.map((x) => spoken(x)) : xs as undefined);

/** The conversation opener is stored as JSON ({"__arcOpener": {lead, bullets, invitation, …}}): clean its strings. */
function deepSpoken(v: unknown): unknown {
  if (typeof v === 'string') return spoken(v);
  if (Array.isArray(v)) return v.map(deepSpoken);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, deepSpoken(x)]));
  return v;
}
function bbTurn(content: string): string {
  const t = (content ?? '').trim();
  if (t.startsWith('{')) { try { return JSON.stringify(deepSpoken(JSON.parse(t))); } catch { return content; } }
  return spoken(content);
}

export function spokenView(v: ArcView): ArcView {
  const u = v.understanding;
  return {
    ...v,
    ...(v.error ? { error: { ...v.error, detail: v.error.detail ? s(v.error.detail) : v.error.detail } } : {}),
    ...(u ? { understanding: {
      ...u,
      does: s(u.does), serves: s(u.serves), standsOut: s(u.standsOut),
      tensions: u.tensions.map((t) => ({ ...t, tension: s(t.tension), grounding: s(t.grounding) })),
      confident: ss(u.confident)!, inferring: ss(u.inferring)!, unanswered: ss(u.unanswered)!,
      constraint: u.constraint && 'text' in u.constraint ? { ...u.constraint, text: s(u.constraint.text) } : u.constraint,
      ...(u.diagnosis ? { diagnosis: { ...u.diagnosis, text: s(u.diagnosis.text) } } : {}),
      ...(u.founderRead ? { founderRead: { ...u.founderRead, myRead: s(u.founderRead.myRead), matters: u.founderRead.matters.map((m) => ({ headline: s(m.headline), body: s(m.body) })) } } : {}),
      ...(u.read ? { read: {
        ...u.read,
        model: u.read.model.map((d) => ({ ...d, lines: d.lines.map((l) => ({ ...l, text: s(l.text) })) })),
        notConcluding: u.read.notConcluding.map((n) => ({ ...n, claim: s(n.claim), why: s(n.why) })),
        untrusted: u.read.untrusted.map((x) => ({ ...x, finding: s(x.finding), why: s(x.why) })),
        asks: u.read.asks.map((a) => ({ ...a, question: s(a.question), why: s(a.why), ...(a.parts ? { parts: a.parts.map((x) => s(x)) } : {}) })),
        ...(u.read.structure ? { structure: {
          ...u.read.structure,
          synthesis: s(u.read.structure.synthesis),
          // evidence quotes are the source's own words: never rewritten
          hypotheses: u.read.structure.hypotheses.map((h) => ({ ...h, pattern: s(h.pattern), interpretation: s(h.interpretation), alternative: s(h.alternative), reversal: s(h.reversal) })),
          ...(u.read.structure.founder ? { founder: {
            ...u.read.structure.founder,
            ...(u.read.structure.founder.routes ? { routes: s(u.read.structure.founder.routes) } : {}),
            ...(u.read.structure.founder.placeFacts ? { placeFacts: u.read.structure.founder.placeFacts.map((x) => s(x)) } : {}),
          } } : {}),
        } } : {}),
      } } : {}),
      // Stage evidence lines are fragments joined into one "Why: a; b." sentence: no closing punctuation of their own.
      stage: u.stage && 'evidence' in u.stage ? { ...u.stage, evidence: u.stage.evidence.map((e) => s(e).trim().replace(/[.;,:]+$/, '')) } : u.stage,
    } } : {}),
    ...(v.turns ? { turns: v.turns.map((t) => (t.role === 'bb' ? { ...t, content: bbTurn(t.content) } : t)) } : {}),
    ...(v.mirror ? { mirror: { ...v.mirror, against: s(v.mirror.against), tension: s(v.mirror.tension),
      ...(v.mirror.read ? { read: { now: s(v.mirror.read.now), ...(v.mirror.read.changed ? { changed: s(v.mirror.read.changed) } : {}),
        ...(v.mirror.read.matters ? { matters: s(v.mirror.read.matters) } : {}), ...(v.mirror.read.next ? { next: s(v.mirror.read.next) } : {}) } } : {}) } } : {}),
    ...(v.strategy ? { strategy: {
      ...v.strategy, bet: s(v.strategy.bet), over: s(v.strategy.over), horizon: s(v.strategy.horizon),
      tradeOffs: ss(v.strategy.tradeOffs)!, notNow: ss(v.strategy.notNow)!, reconsider: ss(v.strategy.reconsider)!,
      assumedGoal: v.strategy.assumedGoal ? s(v.strategy.assumedGoal) : v.strategy.assumedGoal,
    } } : {}),
    ...(v.weekDay ? { weekDay: {
      ...v.weekDay, week: ss(v.weekDay.week)!, today: v.weekDay.today ? s(v.weekDay.today) : v.weekDay.today,
      story: v.weekDay.story ? {
        ...v.weekDay.story, context: s(v.weekDay.story.context), statement: s(v.weekDay.story.statement), whyNow: s(v.weekDay.story.whyNow),
        chapters: v.weekDay.story.chapters.map((c) => ({ title: s(c.title), why: s(c.why) })),
        today: { ...v.weekDay.story.today, move: s(v.weekDay.story.today.move), detail: s(v.weekDay.story.today.detail) }, doneLooksLike: s(v.weekDay.story.doneLooksLike),
      } : v.weekDay.story,
    } } : {}),
    ...(v.email ? { email: { subject: s(v.email.subject), body: s(v.email.body) } } : {}),
    ...(v.correctionReflection ? { correctionReflection: {
      reflection: s(v.correctionReflection.reflection), changes: s(v.correctionReflection.changes), holds: s(v.correctionReflection.holds),
    } } : {}),
    ...(v.container ? { container: { ...v.container, items: v.container.items.map((it) => (it.provenance === 'declared' ? it : { ...it, statement: s(it.statement) })) } } : {}),
  };
}
