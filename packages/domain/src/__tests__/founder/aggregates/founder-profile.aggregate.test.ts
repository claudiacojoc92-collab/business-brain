import { describe, it, expect } from 'vitest';
import { FounderProfile } from '../../../founder/aggregates/founder-profile.aggregate';
import { IntakeSession } from '../../../founder/entities/intake-session.entity';
import { FounderVoice } from '../../../founder/value-objects/founder-voice.vo';
import { BeliefChain } from '../../../founder/value-objects/belief-chain.vo';
import { ConvictionAngle } from '../../../founder/value-objects/conviction-angle.vo';
import { AudienceLanguageFingerprint } from '../../../founder/value-objects/audience-language-fingerprint.vo';
import { Audience } from '../../../founder/value-objects/audience.vo';
import { Offer } from '../../../founder/value-objects/offer.vo';
import { FounderEligibilityService } from '../../../founder/domain-services/founder-eligibility.service';
import { RECALIBRATION_COOLDOWN_DAYS } from '@bb/shared';

const NOW = new Date('2025-01-06T04:00:00Z');
const CORR = 'corr-01';
const TRACE = 'trace-01';

function makeVoice(): FounderVoice {
  return new FounderVoice({
    versionNumber:      1,
    derivedFrom:        'INTAKE',
    sentenceRhythm:     'SHORT_DECLARATIVE',
    openingPattern:     'Let me be direct.',
    closingPattern:     'The choice is yours.',
    convictionPosture:  'OPINION_FIRST',
    vulnerabilityLevel: 'LOW',
    specificityLevel:   'ALWAYS_SPECIFIC',
    ctaStyle:           'INVITATION',
  });
}

function makeBeliefChain(): BeliefChain {
  return new BeliefChain({
    versionNumber: 1,
    beliefs: [
      { step: 1, content: 'Marketing is hard for service businesses.', beliefType: 'PROBLEM' },
      { step: 2, content: 'A clear conviction angle makes it easier.', beliefType: 'SOLUTION' },
    ],
  });
}

function makeConviction(): ConvictionAngle {
  return new ConvictionAngle({
    versionNumber: 1,
    statement:     'Most marketing advice fails service businesses because it ignores the trust gap entirely.',
    domain:        'marketing',
    confidence:    0.8,
    derivedFrom:   'INTAKE',
  });
}

function makeAudience(): Audience {
  const fingerprint = new AudienceLanguageFingerprint({
    versionNumber:      1,
    primaryPhrases:     ['consistent clients'],
    avoidPhrases:       ['hustle'],
    emotionalRegister:  'ASPIRATIONAL',
    failedAlternatives: ['cold outreach'],
  });
  return new Audience({
    id:                  'aud-01',
    description:         'Service-based professionals.',
    preEngagementState:  'Overwhelmed by inconsistent leads.',
    sophisticationLevel: 'GROWTH',
    primaryPlatform:     'INSTAGRAM',
    languageFingerprint: fingerprint,
  });
}

function makeOffer(): Offer {
  return new Offer({
    id:               'offer-01',
    versionNumber:    1,
    name:             'Marketing Clarity Package',
    primaryPromise:   'Consistent clients without constant hustle.',
    priceTier:        'MID',
    salesMechanism:   'DISCOVERY_CALL',
    maturity:         'NEW',
    availability:     'OPEN',
    capacityAvailable:true,
  });
}

function makeSession(overrides: { completedAt?: Date | null } = {}): IntakeSession {
  return new IntakeSession({
    id:                   'session-01',
    founderId:            'founder-01',
    signals:              new Map([
      ['FOUNDING_STORY', 'I started because...'],
      ['CONVICTION_ANGLE', 'My conviction is...'],
      ['AUDIENCE_DESCRIPTION', 'My audience is...'],
      ['OFFER_DETAILS', 'My offer is...'],
      ['BUSINESS_GOAL', 'My goal is...'],
      ['VOICE_SAMPLE', 'Here is my voice...'],
      ['AUDIENCE_VOCABULARY', 'They say...'],
      ['FAILED_ALTERNATIVES', 'They tried...'],
      ['INDUSTRY_CONVICTION', 'I believe...'],
    ]),
    mandatorySignalTypes: [
      'FOUNDING_STORY', 'CONVICTION_ANGLE', 'AUDIENCE_DESCRIPTION',
      'OFFER_DETAILS', 'BUSINESS_GOAL', 'VOICE_SAMPLE',
      'AUDIENCE_VOCABULARY', 'FAILED_ALTERNATIVES', 'INDUSTRY_CONVICTION',
    ],
    expiresAt:            new Date('2025-01-13T04:00:00Z'),
    completedAt:          overrides.completedAt ?? null,
    abandonedAt:          null,
  });
}

describe('FounderProfile.register', () => {
  it('creates founder in CREATED state', () => {
    const f = FounderProfile.register({
      email: 'test@example.com', name: 'Test', businessName: 'Biz',
      timezone: 'UTC', correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(f.status).toBe('CREATED');
  });

  it('emits FounderCreated event', () => {
    const f = FounderProfile.register({
      email: 'test@example.com', name: 'Test', businessName: 'Biz',
      timezone: 'UTC', correlationId: CORR, traceId: TRACE, now: NOW,
    });
    const events = f.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('founder.FounderProfile.FounderCreated');
  });

  it('sets autoApproveOnWindowClose true by default (F004)', () => {
    const f = FounderProfile.register({
      email: 'test@example.com', name: 'Test', businessName: 'Biz',
      timezone: 'UTC', correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(f.autoApproveOnWindowClose).toBe(true);
    expect(f.approvalWindowHours).toBe(72);
  });
});

describe('FounderProfile.startIntake', () => {
  it('transitions to INTAKE_PENDING', () => {
    const f = FounderProfile.register({
      email: 'test@example.com', name: 'Test', businessName: 'Biz',
      timezone: 'UTC', correlationId: CORR, traceId: TRACE, now: NOW,
    });
    f.pullEvents();
    const result = f.startIntake({
      sessionId: 'session-01', mandatorySignalTypes: ['FOUNDING_STORY'],
      expiresAt: new Date('2025-01-13T04:00:00Z'), correlationId: CORR, traceId: TRACE,
    });
    expect(result.isOk).toBe(true);
    expect(f.status).toBe('INTAKE_PENDING');
  });

  it('fails if already INTAKE_PENDING', () => {
    const f = FounderProfile.register({
      email: 'test@example.com', name: 'Test', businessName: 'Biz',
      timezone: 'UTC', correlationId: CORR, traceId: TRACE, now: NOW,
    });
    f.pullEvents();
    f.startIntake({
      sessionId: 's1', mandatorySignalTypes: [],
      expiresAt: new Date(), correlationId: CORR, traceId: TRACE,
    });
    const result = f.startIntake({
      sessionId: 's2', mandatorySignalTypes: [],
      expiresAt: new Date(), correlationId: CORR, traceId: TRACE,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('FOUNDER_NOT_IN_CREATED_STATE');
  });
});

describe('FounderProfile.completeIntake', () => {
  it('transitions to INTAKE_COMPLETE and sets value objects', () => {
    const f = FounderProfile.register({
      email: 'test@example.com', name: 'Test', businessName: 'Biz',
      timezone: 'UTC', correlationId: CORR, traceId: TRACE, now: NOW,
    });
    f.pullEvents();
    f.startIntake({
      sessionId: 'session-01', mandatorySignalTypes: [],
      expiresAt: new Date('2025-01-13T04:00:00Z'), correlationId: CORR, traceId: TRACE,
    });
    f.pullEvents();
    const result = f.completeIntake({
      session: makeSession(), voice: makeVoice(), beliefChain: makeBeliefChain(),
      conviction: makeConviction(), audience: makeAudience(), offer: makeOffer(),
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isOk).toBe(true);
    expect(f.status).toBe('INTAKE_COMPLETE');
    expect(f.currentOffer?.name).toBe('Marketing Clarity Package');
  });

  it('fails if signals incomplete', () => {
    const f = FounderProfile.register({
      email: 'test@example.com', name: 'Test', businessName: 'Biz',
      timezone: 'UTC', correlationId: CORR, traceId: TRACE, now: NOW,
    });
    f.pullEvents();
    f.startIntake({
      sessionId: 'session-01', mandatorySignalTypes: ['MISSING_SIGNAL'],
      expiresAt: new Date('2025-01-13T04:00:00Z'), correlationId: CORR, traceId: TRACE,
    });
    f.pullEvents();
    const emptySession = new IntakeSession({
      id: 'session-01', founderId: f.id,
      signals: new Map(), mandatorySignalTypes: ['MISSING_SIGNAL'],
      expiresAt: new Date('2025-01-13T04:00:00Z'),
      completedAt: null, abandonedAt: null,
    });
    const result = f.completeIntake({
      session: emptySession, voice: makeVoice(), beliefChain: makeBeliefChain(),
      conviction: makeConviction(), audience: makeAudience(), offer: makeOffer(),
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('INTAKE_INCOMPLETE');
  });
});

describe('FounderProfile.pause and resume', () => {
  function makeActiveFounder(): FounderProfile {
    const f = FounderProfile.reconstitute({
      id: 'f-01', email: 'a@b.com', name: 'A', businessName: 'B',
      timezone: 'UTC', status: 'ACTIVE',
      currentVoice: makeVoice(), currentBeliefChain: makeBeliefChain(),
      currentConviction: makeConviction(), currentAudience: makeAudience(),
      currentOffer: makeOffer(), notificationChannel: 'EMAIL',
      autoApproveOnWindowClose: true, approvalWindowHours: 72,
      registeredAt: NOW, activatedAt: NOW, pausedAt: null,
    });
    return f;
  }

  it('pause transitions to PAUSED', () => {
    const f = makeActiveFounder();
    const r = f.pause({ correlationId: CORR, traceId: TRACE, now: NOW });
    expect(r.isOk).toBe(true);
    expect(f.status).toBe('PAUSED');
  });

  it('pause fails if already PAUSED', () => {
    const f = makeActiveFounder();
    f.pause({ correlationId: CORR, traceId: TRACE, now: NOW });
    f.pullEvents();
    const r = f.pause({ correlationId: CORR, traceId: TRACE, now: NOW });
    expect(r.isErr).toBe(true);
    expect(r.isErr && r.error.code).toBe('FOUNDER_ALREADY_PAUSED');
  });

  it('resume transitions PAUSED back to ACTIVE', () => {
    const f = makeActiveFounder();
    f.pause({ correlationId: CORR, traceId: TRACE, now: NOW });
    f.pullEvents();
    const r = f.resume({
      nextCycleScheduledFor: new Date('2025-01-13T03:30:00Z'),
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(r.isOk).toBe(true);
    expect(f.status).toBe('ACTIVE');
  });

  it('resume fails if not PAUSED', () => {
    const f = makeActiveFounder();
    const r = f.resume({
      nextCycleScheduledFor: new Date(), correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(r.isErr).toBe(true);
    expect(r.isErr && r.error.code).toBe('FOUNDER_NOT_PAUSED');
  });
});

describe('FounderProfile.triggerRecalibration (F017)', () => {
  function makeActiveFounder(): FounderProfile {
    return FounderProfile.reconstitute({
      id: 'f-01', email: 'a@b.com', name: 'A', businessName: 'B',
      timezone: 'UTC', status: 'ACTIVE',
      currentVoice: makeVoice(), currentBeliefChain: makeBeliefChain(),
      currentConviction: makeConviction(), currentAudience: makeAudience(),
      currentOffer: makeOffer(), notificationChannel: 'EMAIL',
      autoApproveOnWindowClose: true, approvalWindowHours: 72,
      registeredAt: NOW, activatedAt: NOW, pausedAt: null,
    });
  }

  it('succeeds when no prior recalibration', () => {
    const f = makeActiveFounder();
    const r = f.triggerRecalibration({
      sessionId: 'sess-01', recalibrationType: 'VOICE',
      questions: [], expiresAt: new Date('2025-01-13T04:00:00Z'),
      triggeredBy: 'FOUNDER', triggerReason: 'Requested',
      daysSinceLastRecalibration: null,
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(r.isOk).toBe(true);
    expect(f.status).toBe('RECALIBRATING');
  });

  it('fails when within 14-day cooldown (F017)', () => {
    const f = makeActiveFounder();
    const r = f.triggerRecalibration({
      sessionId: 'sess-01', recalibrationType: 'VOICE',
      questions: [], expiresAt: new Date(),
      triggeredBy: 'FOUNDER', triggerReason: 'Requested',
      daysSinceLastRecalibration: 5,
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(r.isErr).toBe(true);
    expect(r.isErr && r.error.code).toBe('RECALIBRATION_COOLDOWN_ACTIVE');
  });

  it('succeeds when exactly at cooldown boundary', () => {
    const f = makeActiveFounder();
    const r = f.triggerRecalibration({
      sessionId: 'sess-01', recalibrationType: 'VOICE',
      questions: [], expiresAt: new Date(),
      triggeredBy: 'FOUNDER', triggerReason: 'Requested',
      daysSinceLastRecalibration: RECALIBRATION_COOLDOWN_DAYS,
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(r.isOk).toBe(true);
  });
});

describe('FounderEligibilityService', () => {
  it('blocks CONVERSION when offer is FULL', () => {
    const svc = new FounderEligibilityService();
    const f = FounderProfile.reconstitute({
      id: 'f-01', email: 'a@b.com', name: 'A', businessName: 'B',
      timezone: 'UTC', status: 'ACTIVE',
      currentVoice: null, currentBeliefChain: null,
      currentConviction: null, currentAudience: null,
      currentOffer: new Offer({
        id: 'o1', versionNumber: 1, name: 'Test', primaryPromise: 'Promise',
        priceTier: 'MID', salesMechanism: 'DISCOVERY_CALL',
        maturity: 'NEW', availability: 'FULL', capacityAvailable: false,
      }),
      notificationChannel: 'EMAIL',
      autoApproveOnWindowClose: true, approvalWindowHours: 72,
      registeredAt: NOW, activatedAt: NOW, pausedAt: null,
    });
    const flags = svc.computeEligibilityFlags(f);
    expect(flags.modesEligible).not.toContain('CONVERSION');
    expect(flags.conversionBlockedReason).toBeTruthy();
  });

  it('includes CONVERSION when offer is OPEN with capacity', () => {
    const svc = new FounderEligibilityService();
    const f = FounderProfile.reconstitute({
      id: 'f-01', email: 'a@b.com', name: 'A', businessName: 'B',
      timezone: 'UTC', status: 'ACTIVE',
      currentVoice: null, currentBeliefChain: null,
      currentConviction: null, currentAudience: null,
      currentOffer: new Offer({
        id: 'o1', versionNumber: 1, name: 'Test', primaryPromise: 'Promise',
        priceTier: 'MID', salesMechanism: 'DISCOVERY_CALL',
        maturity: 'NEW', availability: 'OPEN', capacityAvailable: true,
      }),
      notificationChannel: 'EMAIL',
      autoApproveOnWindowClose: true, approvalWindowHours: 72,
      registeredAt: NOW, activatedAt: NOW, pausedAt: null,
    });
    const flags = svc.computeEligibilityFlags(f);
    expect(flags.modesEligible).toContain('CONVERSION');
    expect(flags.conversionBlockedReason).toBeNull();
  });
});
