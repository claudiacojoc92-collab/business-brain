import { describe, it, expect } from 'vitest';
import { validateStrategy, type StrategyContextForGate } from '../../strategy/index';
import type { StrategyBundle } from '../../strategy/contracts';

const CTX: StrategyContextForGate = {
  business: [
    { ref: 'B1', text: 'Offer: bespoke Rails consulting for healthcare software teams' },
    { ref: 'B2', text: 'Conversion paths on the site: /hire-us page exists but the homepage gives no clear next action' },
    { ref: 'B3', text: 'Positioning: senior engineering expertise, delivery-focused' },
  ],
  founder: [
    { ref: 'F1', kind: 'goal', statement: 'land 10 recurring retainer clients' },
    { ref: 'F2', kind: 'horizon', statement: '6 months' },
    { ref: 'F3', kind: 'constraint', statement: 'must not depend on daily personal video or being on camera' },
    { ref: 'F4', kind: 'resource', statement: '8 hours a week and a small budget' },
    { ref: 'F5', kind: 'preference', statement: 'would rather grow through referrals and healthcare events' },
  ],
  observation: [],
};

function validBundle(): StrategyBundle {
  return {
    core: {
      goal: 'Land 10 recurring retainer clients',
      horizon: '6 months',
      diagnosis: 'The bottleneck is not content volume: the homepage gives healthcare software buyers no clear next action toward a retainer conversation, so warm interest never converts to a scoping call.',
      coreBet: {
        priority: 'Convert the existing warm referral network into retainer scoping conversations',
        deprioritized: 'Broad content-led inbound to a cold audience',
        whyOverAlternative: 'The homepage conversion path is broken and the founder has limited hours, so warm referrals reach retainer buyers faster than rebuilding cold inbound',
        relationToGoal: 'Retainer clients come fastest from warm healthcare software relationships',
        relationToBottleneck: 'It routes around the broken homepage next-action problem',
        founderFit: 'Uses referrals, not daily personal video the founder ruled out',
        resourceFit: 'Fits 8 hours a week with a small budget',
      },
      offerDirection: 'Position bespoke Rails consulting as retainer engagements',
      positioningDirection: 'Senior engineering expertise for healthcare software teams',
      audiencePrimaryForGoal: 'Engineering leaders at healthcare software companies who already know the founder',
      audienceRoles: [{ role: 'buyer', who: 'engineering leaders at healthcare software companies' }],
      founderConstraints: ['no daily personal video'],
      resourceEnvelope: ['8 hours a week', 'small budget'],
      assumptions: [{ statement: 'The warm network contains enough relevant healthcare buyers to test the retainer offer' }],
      tradeOffs: [{ choosing: 'warm referrals', over: 'cold inbound content', why: 'faster path to retainer buyers within the time budget' }],
      notNow: [{ item: 'Broad follower growth', reason: 'It does not move retainer conversations in 6 months' }],
      reconsiderTriggers: [{ condition: 'If 15 warm referral conversations produce no serious retainer interest, revisit the audience/offer assumption' }],
    },
    branch: {
      market: 'US healthcare software consulting',
      language: 'en',
      messagingDirection: 'Show delivery credibility through concrete healthcare software case studies',
      channelPriorities: [{
        channel: 'Warm referral outreach to past healthcare software contacts',
        whyGoal: 'Reaches retainer buyers who already trust the delivery track record',
        whyAudience: 'These are the engineering leaders who buy retainers',
        whyResource: 'Fits a few hours a week, no budget needed',
        overAlternative: 'Prioritized over cold content because the homepage path is broken',
        assumption: 'The past network is still reachable and relevant',
      }],
      acquisitionApproach: 'Direct warm outreach to a scoping conversation',
      contentRole: 'Minimal — case studies as proof, no personal video',
      ctaDirection: 'One clear route to book a scoping call for the healthcare retainer offer',
    },
    decisions: [
      { key: 'warm-first', title: 'Warm referrals before cold inbound', rationale: 'The homepage conversion path is broken and hours are limited', sourceRefs: ['B2'], founderRefs: ['F1', 'F4'], claimStrength: 'bounded', assumption: 'Warm network has enough buyers', reconsiderTrigger: '15 conversations, no interest' },
    ],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (b: StrategyBundle): any => JSON.parse(JSON.stringify(b));

describe('validateStrategy — M1 deterministic gate stack', () => {
  it('passes a real, specific, coherent strategy', () => {
    const v = validateStrategy(validBundle(), CTX);
    expect(v.pass).toBe(true);
  });

  describe('structure', () => {
    it('fails when the core bet is missing', () => {
      const b = clone(validBundle()); b.core.coreBet.priority = '';
      expect(validateStrategy(b, CTX).pass).toBe(false);
    });
    it('fails when there is no explicit trade-off', () => {
      const b = clone(validBundle()); b.core.coreBet.deprioritized = ''; b.core.tradeOffs = [];
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'trade_off_explicit' || f.gate === 'core_bet_present')).toBe(true);
    });
    it('fails when nothing is deliberately not-now', () => {
      const b = clone(validBundle()); b.core.notNow = [];
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'not_now_explicit')).toBe(true);
    });
    it('fails when assumptions or reconsider triggers are missing', () => {
      const b = clone(validBundle()); b.core.assumptions = []; b.core.reconsiderTriggers = [];
      const gs = validateStrategy(b, CTX).failures.map((f) => f.gate);
      expect(gs).toContain('assumptions_explicit');
      expect(gs).toContain('reconsider_explicit');
    });
    it('fails on dangling refs', () => {
      const b = clone(validBundle()); b.decisions[0]!.sourceRefs = ['B9']; b.decisions[0]!.founderRefs = ['F9'];
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'refs_resolvable')).toBe(true);
    });
  });

  describe('founder fit', () => {
    it('fails when a hard constraint is violated (daily talking-head)', () => {
      const b = clone(validBundle());
      b.branch.contentRole = 'Daily talking head video from the founder on camera';
      b.branch.channelPriorities[0]!.channel = 'Daily personal video on Instagram';
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'hard_constraint_respected')).toBe(true);
    });
    it('respects a preference and passes when trade-off is shown', () => {
      expect(validateStrategy(validBundle(), CTX).pass).toBe(true);
    });
    it('fails a resource-infeasible strategy (too many channels for the time)', () => {
      const b = clone(validBundle());
      b.branch.channelPriorities = ['A', 'B', 'C', 'D'].map((c) => ({ channel: `Channel ${c} outreach`, whyGoal: 'reach', whyAudience: 'a', whyResource: 'r', overAlternative: 'o', assumption: 'x' }));
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'resource_feasible')).toBe(true);
    });
    it('fails when paid acquisition is prioritized against a small budget', () => {
      const b = clone(validBundle());
      b.branch.channelPriorities[0]!.channel = 'Paid ads on LinkedIn';
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'resource_feasible' || f.gate === 'hard_constraint_respected')).toBe(true);
    });
  });

  describe('genericity', () => {
    it('fails a platitude strategy', () => {
      const b = clone(validBundle());
      b.core.diagnosis = 'You need to know your audience and be consistent and provide value to build trust.';
      b.core.coreBet.priority = 'Be consistent and provide value';
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'anti_genericity')).toBe(true);
    });
    it('fails a transplantable strategy with no business-specific anchors', () => {
      const b = clone(validBundle());
      b.core.diagnosis = 'The core problem is turning early interest into paying commitments within a reasonable timeframe.';
      b.core.coreBet = { priority: 'Commit to one activity before adding anything else', deprioritized: 'Trying to do everything at once', whyOverAlternative: 'One committed activity beats spreading attention too thin', relationToGoal: 'It serves the goal', relationToBottleneck: 'It tackles the core problem directly', founderFit: 'Fits how they like to work', resourceFit: 'Fits the time available' };
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'anti_transplant')).toBe(true);
    });
  });

  describe('coherence', () => {
    it('fails goal(clients) ↔ bet(followers) mismatch', () => {
      const b = clone(validBundle());
      b.core.coreBet.priority = 'Maximize followers and follower growth on social';
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'coherence_goal_bet')).toBe(true);
    });
    it('fails premium positioning ↔ discount messaging', () => {
      const b = clone(validBundle());
      b.core.positioningDirection = 'Premium high-end bespoke consulting';
      b.branch.messagingDirection = 'Discount urgency, lowest price flash sale';
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'coherence_positioning_messaging')).toBe(true);
    });
    it('fails B2B audience ↔ generic follow CTA', () => {
      const b = clone(validBundle());
      b.core.audiencePrimaryForGoal = 'B2B enterprise engineering buyers at companies';
      b.branch.ctaDirection = 'Follow for more tips and follow us';
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'coherence_audience_cta')).toBe(true);
    });
  });

  describe('claim discipline', () => {
    it('fails an unsupported outcome prediction', () => {
      const b = clone(validBundle());
      b.decisions[0]!.rationale = 'This will generate leads and increase conversion for the business';
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'no_outcome_prediction')).toBe(true);
    });
    it('fails an unevidenced market-superiority claim', () => {
      const b = clone(validBundle());
      b.branch.channelPriorities[0]!.whyGoal = 'This is the highest-leverage, most effective channel that will outperform all others';
      expect(validateStrategy(b, CTX).failures.some((f) => f.gate === 'no_unevidenced_superiority')).toBe(true);
    });
    it('fails when audience upgrades a channel preference into a target segment', () => {
      const b = clone(validBundle());
      b.core.audiencePrimaryForGoal = 'Your preference for events points toward a specific segment as your primary segment';
      // remove the licensing goal/intention kinds from ctx so the upgrade cannot be licensed
      const ctxNoGoal: StrategyContextForGate = { ...CTX, founder: CTX.founder.map((f) => (f.kind === 'goal' ? { ...f, kind: 'preference' } : f)) };
      expect(validateStrategy(b, ctxNoGoal).failures.some((f) => f.gate === 'founder_state_compatible')).toBe(true);
    });
  });
});
