import { predictsUnlicensedOutcome, upgradesFounderState } from '../conversation/validation';
import type { StrategyBundle, StrategyGateResult } from './contracts';

/**
 * M1 Strategy Quality — the DETERMINISTIC / STRUCTURAL gate stack (fail-closed). This enforces the
 * frozen minimum: a real load-bearing bet, an explicit trade-off, explicit "not now", named
 * assumptions + reconsider triggers, resolvable refs, hard-constraints-not-violated, resource
 * feasibility, coherence, anti-genericity/transplant, and claim discipline (outcome / superiority /
 * founder-state-upgrade). Judged dimensions (grounding/coherence nuance/fit quality) are additionally
 * assessed by the LLM judge in the service; both feed the same repair loop. Each failure carries a
 * `component` so the service can repair ONLY that part.
 */

export interface StrategyContextForGate {
  business: { ref: string; text: string }[];
  founder: { ref: string; kind: string; statement: string }[];
  observation: { ref: string; behavior: string }[];
}

export interface StrategyGateFailure {
  readonly gate: string;
  readonly component: string; // 'coreBet' | 'notNow' | 'assumptions' | 'reconsider' | 'diagnosis' | 'branch' | 'channelPriorities' | 'audience' | 'decisions' | 'goal' | 'horizon'
  readonly detail: string;
}

export interface StrategyValidation {
  readonly pass: boolean;
  readonly failures: StrategyGateFailure[];
  readonly gateResults: StrategyGateResult[];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'their', 'your', 'from', 'into', 'about', 'which',
  'while', 'they', 'them', 'have', 'will', 'would', 'should', 'could', 'because', 'these', 'those',
  'business', 'strategy', 'audience', 'content', 'marketing', 'current', 'currently', 'goal', 'over',
  'more', 'than', 'what', 'when', 'where', 'there', 'here', 'been', 'being', 'each', 'other', 'around',
  'through', 'using', 'within', 'before', 'after', 'still', 'first', 'main', 'something', 'anything',
]);

const PLATITUDE_TERMS = [
  'know your audience', 'be consistent', 'stay consistent', 'post consistently', 'show up consistently',
  'provide value', 'add value', 'engage with your audience', 'build trust', 'create quality content',
  'be authentic', 'tell your story', 'content is king', 'be everywhere', 'just start', 'be genuine',
  'focus on your audience', 'improve conversion', 'increase engagement',
];
const SUPERIORITY_TERMS = [
  'best channel', 'best strategy', 'best approach', 'highest leverage', 'highest-leverage',
  'most effective', 'will outperform', 'guaranteed', 'optimal channel', 'the best way', 'market leader',
  'dominate the market', 'beat the competition', 'steal market share', 'outrank competitors',
];
const NEGATION = /\b(no|not|without|avoid|instead of|rather than|minimal|none|free of|independent of|non-|isn'?t|doesn'?t|won'?t|drop|stop|de-?prioriti[sz]e)\b/;

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-zàâäéèêëïîôöùûüçăâîșț]{5,}/gi) ?? []).filter((w) => !STOPWORDS.has(w));
}

/** A field "prescribes" a mode when it names it WITHOUT a nearby negation (respecting a constraint reads as negated). */
function prescribes(field: string, mode: string): boolean {
  const f = field.toLowerCase();
  if (!f.includes(mode)) return false;
  return !NEGATION.test(f);
}

function anyPrescribes(fields: string[], modes: string[]): boolean {
  return fields.some((f) => modes.some((m) => prescribes(f, m)));
}

function hasPlatitude(text: string): boolean {
  const t = text.toLowerCase();
  return PLATITUDE_TERMS.some((p) => t.includes(p));
}
function claimsSuperiority(text: string): boolean {
  const t = text.toLowerCase();
  return SUPERIORITY_TERMS.some((p) => t.includes(p));
}

export function validateStrategy(bundle: StrategyBundle, ctx: StrategyContextForGate): StrategyValidation {
  const failures: StrategyGateFailure[] = [];
  const results: StrategyGateResult[] = [];
  const add = (ok: boolean, gate: string, component: string, detail: string) => {
    results.push({ gate, pass: ok, detail: ok ? 'ok' : detail });
    if (!ok) failures.push({ gate, component, detail });
  };

  const { core, branch, decisions } = bundle;
  const businessSet = new Set(ctx.business.map((e) => e.ref));
  const founderKinds = new Map(ctx.founder.map((e) => [e.ref, e.kind]));

  // ── structural presence ──
  add(core.goal?.trim().length > 0, 'goal_present', 'goal', 'Goal is missing.');
  add(core.horizon?.trim().length > 0, 'horizon_present', 'horizon', 'Horizon is missing.');
  add((core.diagnosis?.trim().length ?? 0) >= 30, 'diagnosis_present', 'diagnosis', 'Strategic diagnosis is missing or too thin.');
  const bet = core.coreBet;
  add(!!bet?.priority?.trim() && !!bet?.deprioritized?.trim() && !!bet?.whyOverAlternative?.trim(),
    'core_bet_present', 'coreBet', 'Core bet must name a priority, a deprioritized alternative, and why one over the other.');
  add((core.tradeOffs?.length ?? 0) >= 1 || (!!bet?.deprioritized?.trim() && bet.deprioritized.toLowerCase() !== bet.priority?.toLowerCase()),
    'trade_off_explicit', 'coreBet', 'Strategy must contain an explicit trade-off.');
  add((core.notNow ?? []).some((n) => n.item?.trim() && n.reason?.trim()), 'not_now_explicit', 'notNow', 'Strategy must say what it is deliberately NOT doing, with a reason.');
  add((core.assumptions ?? []).some((a) => a.statement?.trim()), 'assumptions_explicit', 'assumptions', 'Load-bearing assumptions must be named.');
  add((core.reconsiderTriggers ?? []).some((r) => r.condition?.trim()), 'reconsider_explicit', 'reconsider', 'Strategy must name what would make BB reconsider.');

  // ── branch presence ──
  add(!!branch?.market?.trim() && !!branch?.language?.trim() && !!branch?.ctaDirection?.trim(), 'branch_present', 'branch', 'Execution branch (market/language/CTA) is incomplete.');
  const chans = branch?.channelPriorities ?? [];
  add(chans.length >= 1 && chans.every((c) => c.channel?.trim() && c.whyGoal?.trim() && c.whyResource?.trim() && c.overAlternative?.trim()),
    'channel_prioritized', 'channelPriorities', 'At least one channel must be prioritized with why-goal / why-resource / over-alternative.');

  // ── refs resolvable ──
  const danglingBusiness = decisions.flatMap((d) => d.sourceRefs ?? []).filter((r) => !businessSet.has(r));
  const danglingFounder = decisions.flatMap((d) => d.founderRefs ?? []).filter((r) => !founderKinds.has(r));
  add(danglingBusiness.length === 0 && danglingFounder.length === 0, 'refs_resolvable', 'decisions', `Unresolvable refs: ${[...danglingBusiness, ...danglingFounder].join(', ')}`);
  const resolvableRefs = decisions.flatMap((d) => [...(d.sourceRefs ?? []).filter((r) => businessSet.has(r)), ...(d.founderRefs ?? []).filter((r) => founderKinds.has(r))]).length;
  add(decisions.length >= 1 && resolvableRefs >= 1, 'decisions_grounded', 'decisions', 'Material decisions must resolve to real evidence / founder-state refs.');
  add(decisions.every((d) => !!d.rationale?.trim() && ['evidenced', 'bounded', 'assumption'].includes(d.claimStrength)), 'decisions_wellformed', 'decisions', 'Every decision needs a rationale and a valid claim strength.');

  // ── founder-fit: hard constraints (kind constraint) must not be violated ──
  const exec = [core.coreBet?.priority ?? '', branch?.contentRole ?? '', branch?.acquisitionApproach ?? '', branch?.ctaDirection ?? '', branch?.messagingDirection ?? '', ...chans.map((c) => `${c.channel} ${c.whyGoal} ${c.overAlternative}`)];
  for (const c of ctx.founder.filter((f) => f.kind === 'constraint')) {
    const s = c.statement.toLowerCase();
    const hitsVideo = /video|camera|on camera|talking head|personal content|personal brand|daily content|founder-led|being the face|my face|daily personal/.test(s);
    const hitsPaid = /paid ad|paid ads|paid acquisition|paid media|advertising|running ads/.test(s);
    if (hitsVideo && anyPrescribes(exec, ['video', 'camera', 'talking head', 'talking-head', 'vlog', 'personal brand', 'face-to-camera', 'daily personal content'])) {
      add(false, 'hard_constraint_respected', 'coreBet', `Strategy relies on something the founder ruled out: "${c.statement}"`);
    }
    if (hitsPaid && anyPrescribes(exec, ['paid ad', 'paid ads', 'paid acquisition', 'paid media', 'run ads', 'advertising campaign'])) {
      add(false, 'hard_constraint_respected', 'channelPriorities', `Strategy relies on paid acquisition the founder ruled out: "${c.statement}"`);
    }
  }

  // ── founder-fit: resource envelope must change decisions ──
  const challengePaid = ctx.founder.some((f) => f.kind === 'challenge_permission' && /budget|paid|ad/.test(f.statement.toLowerCase()));
  for (const r of ctx.founder.filter((f) => f.kind === 'resource')) {
    const s = r.statement.toLowerCase();
    if (/hour|part-time|part time|limited time|few hours|a week|per week/.test(s)) {
      if (anyPrescribes(exec, ['daily', 'every day', 'multi-channel', 'multiple channels', 'several channels', 'across all channels', 'post daily', 'seven days'])) {
        add(false, 'resource_feasible', 'branch', `Strategy assumes more output than the founder's time allows: "${r.statement}"`);
      }
      if (chans.length > 2) add(false, 'resource_feasible', 'channelPriorities', `Too many prioritized channels for the founder's available time ("${r.statement}").`);
    }
    if (/small budget|no budget|tight budget|limited budget|low budget|little budget/.test(s) && !challengePaid) {
      if (chans.some((c) => /paid|ads|advertis/.test(c.channel.toLowerCase()))) {
        add(false, 'resource_feasible', 'channelPriorities', `Paid acquisition prioritized against a small budget with no challenge permission ("${r.statement}").`);
      }
    }
    if (/no team|solo|just me|alone|one-person|one person|by myself|myself/.test(s)) {
      if (anyPrescribes(exec, ['hire', 'specialists', 'team of', 'agency', 'delegate to'])) {
        add(false, 'resource_feasible', 'branch', `Strategy assumes staff the founder does not have ("${r.statement}").`);
      }
    }
  }

  // ── coherence ──
  const goalL = core.goal.toLowerCase();
  const goalClient = /client|customer|revenue|sales|retainer|lead|booking|sign-?up|paying|enquir/.test(goalL);
  const betText = `${bet?.priority ?? ''} ${branch?.messagingDirection ?? ''} ${chans.map((c) => c.channel).join(' ')}`.toLowerCase();
  const betFollowers = /maximi[sz]e followers|follower growth|grow followers|more followers|build a large following|vanity|follower count/.test(betText);
  add(!(goalClient && betFollowers), 'coherence_goal_bet', 'coreBet', 'Goal is client/revenue-oriented but the bet optimizes follower growth.');
  const premium = /premium|high-end|bespoke|luxury|expert|senior|enterprise-grade|specialist/.test(core.positioningDirection.toLowerCase());
  const discount = /discount|cheap|lowest price|urgency|flash sale|limited-time offer|coupon|price war/.test(`${branch?.ctaDirection ?? ''} ${branch?.messagingDirection ?? ''} ${branch?.acquisitionApproach ?? ''}`.toLowerCase());
  add(!(premium && discount), 'coherence_positioning_messaging', 'branch', 'Premium positioning contradicted by discount/urgency messaging.');
  const b2b = /b2b|enterprise|buyer|procurement|decision-maker|company|companies|organization|organisation/.test(`${core.audiencePrimaryForGoal} ${core.audienceRoles.map((r) => r.who).join(' ')}`.toLowerCase());
  const weakCta = /follow for more|follow us|like and follow|follow along|link in bio|dm me for/.test((branch?.ctaDirection ?? '').toLowerCase());
  add(!(b2b && weakCta), 'coherence_audience_cta', 'branch', 'B2B audience but a generic social-follow CTA.');

  // ── anti-genericity / transplant ──
  const betBlob = `${core.diagnosis} ${bet?.priority ?? ''} ${bet?.whyOverAlternative ?? ''} ${bet?.relationToBottleneck ?? ''}`;
  add(!hasPlatitude(betBlob), 'anti_genericity', 'coreBet', 'Diagnosis / core bet reads as a platitude, not a decision.');
  const anchorSet = new Set(ctx.business.flatMap((e) => tokens(e.text)).concat(ctx.founder.flatMap((e) => tokens(e.statement))));
  const anchorsHit = new Set(tokens(betBlob).filter((w) => anchorSet.has(w)));
  add(anchorsHit.size >= 2, 'anti_transplant', 'coreBet', `Strategy lacks business-specific anchors (found ${anchorsHit.size}); it would transplant to another business.`);
  add(!!bet?.deprioritized?.trim() && bet.deprioritized.toLowerCase() !== (bet.priority ?? '').toLowerCase() && !hasPlatitude(bet.deprioritized), 'opposite_is_advice', 'coreBet', 'The deprioritized alternative is not a real, coherent opposite.');

  // ── claim discipline ──
  const claimBlob = [...decisions.map((d) => d.rationale), branch?.ctaDirection ?? '', bet?.relationToGoal ?? '', bet?.relationToBottleneck ?? '', branch?.acquisitionApproach ?? ''].join(' \n ');
  add(!predictsUnlicensedOutcome(claimBlob), 'no_outcome_prediction', 'decisions', 'Strategy predicts an outcome (leads/clients/sales/conversion) the evidence does not license.');
  add(!claimsSuperiority(`${claimBlob} ${chans.map((c) => `${c.channel} ${c.whyGoal}`).join(' ')} ${bet?.whyOverAlternative ?? ''}`), 'no_unevidenced_superiority', 'channelPriorities', 'Strategy claims market superiority ("best" / "highest leverage" / "outperform") the evidence does not license.');
  const audienceBlob = `${core.audiencePrimaryForGoal} ${core.audienceRoles.map((r) => `${r.role} ${r.who}`).join(' ')}`;
  add(!upgradesFounderState(audienceBlob, new Set(founderKinds.values())), 'founder_state_compatible', 'audience', 'Audience upgrades a founder-state type (e.g. a channel preference into a target segment).');

  return { pass: failures.length === 0, failures, gateResults: results };
}
