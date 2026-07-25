import { describe, it, expect } from 'vitest';
import {
  projectRecognition,
  hasDirectEvent,
  mapReviewResponseToStatus,
  deriveSnapshotStatus,
  type RecognitionEvent,
  type RecognitionResponse,
  type SnapshotReview,
  type SubjectRef,
} from '../../index';

const A: SubjectRef = { type: 'business', id: 'A' };
const SK = 'understanding.snapshot.demo::business:A';

let n = 0;
/** Build an event in append order; `at` and id carry NO ordering authority (append order = array order). */
function ev(versionId: string, response: RecognitionResponse): RecognitionEvent {
  n += 1;
  return {
    id: `evt_${n}`,
    businessRef: A,
    snapshotId: 'snap_1',
    statementSemanticKey: SK,
    statementVersionId: versionId,
    response,
    at: '2025-01-06T04:00:00.000Z',
    clientEventId: `client_${n}`,
  };
}
const review = (response: SnapshotReview['response']): SnapshotReview => ({
  id: 'rev_1',
  snapshotId: 'snap_1',
  response,
  at: '2025-01-06T04:00:00.000Z',
});

const V1 = 'stmtver_1';
const V2 = 'stmtver_2'; // a superseding version of the same semanticKey

describe('projectRecognition — no / single exact', () => {
  it('no history → unconfirmed', () => {
    expect(projectRecognition(V1, [])).toBe('unconfirmed');
  });
  it('single exact founder_recognized → founder_recognized', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_recognized')])).toBe('founder_recognized');
  });
  it('single exact founder_qualified → founder_qualified (direct)', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_qualified')])).toBe('founder_qualified');
  });
  it('single exact founder_rejected → founder_rejected (direct)', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_rejected')])).toBe('founder_rejected');
  });
});

describe('projectRecognition — latest exact wins', () => {
  it('recognized then qualified (both exact) → qualified', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_recognized'), ev(V1, 'founder_qualified')])).toBe('founder_qualified');
  });
  it('rejected then recognized (both exact) → recognized', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_rejected'), ev(V1, 'founder_recognized')])).toBe('founder_recognized');
  });
  it('three exact, last rejected → rejected', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_recognized'), ev(V1, 'founder_qualified'), ev(V1, 'founder_rejected')])).toBe('founder_rejected');
  });
  it('qualified then recognized (both exact) → recognized', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_qualified'), ev(V1, 'founder_recognized')])).toBe('founder_recognized');
  });
});

describe('projectRecognition — exact-version precedence over later non-exact', () => {
  it('exact recognized then later non-exact rejected → recognized (exact precedence)', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_recognized'), ev(V2, 'founder_rejected')])).toBe('founder_recognized');
  });
  it('exact rejected then later non-exact recognized → rejected (exact precedence)', () => {
    expect(projectRecognition(V1, [ev(V1, 'founder_rejected'), ev(V2, 'founder_recognized')])).toBe('founder_rejected');
  });
  it('non-exact first then exact qualified → qualified', () => {
    expect(projectRecognition(V1, [ev(V2, 'founder_recognized'), ev(V1, 'founder_qualified')])).toBe('founder_qualified');
  });
});

describe('projectRecognition — carry-forward (no exact match)', () => {
  it('latest non-exact recognized → founder_recognized (carried)', () => {
    expect(projectRecognition(V2, [ev(V1, 'founder_recognized')])).toBe('founder_recognized');
  });
  it('latest non-exact qualified → unconfirmed (qualified never carries)', () => {
    expect(projectRecognition(V2, [ev(V1, 'founder_qualified')])).toBe('unconfirmed');
  });
  it('latest non-exact rejected → unconfirmed (rejected never carries)', () => {
    expect(projectRecognition(V2, [ev(V1, 'founder_rejected')])).toBe('unconfirmed');
  });
  it('earlier recognized but latest qualified → unconfirmed (no backward recovery)', () => {
    expect(projectRecognition(V2, [ev(V1, 'founder_recognized'), ev(V1, 'founder_qualified')])).toBe('unconfirmed');
  });
  it('earlier recognized but latest rejected → unconfirmed (no backward recovery)', () => {
    expect(projectRecognition(V2, [ev(V1, 'founder_recognized'), ev(V1, 'founder_rejected')])).toBe('unconfirmed');
  });
  it('earlier rejected but latest recognized → founder_recognized (carried)', () => {
    expect(projectRecognition(V2, [ev(V1, 'founder_rejected'), ev(V1, 'founder_recognized')])).toBe('founder_recognized');
  });
  it('a near-miss versionId is NOT exact — treated as carry-forward', () => {
    expect(projectRecognition('stmtver_1x', [ev(V1, 'founder_recognized')])).toBe('founder_recognized');
  });
});

describe('projectRecognition — append order is authority, NOT `at` (§7)', () => {
  it('deliberately reversed timestamps do not change the projected state', () => {
    // Append order (array order) says: recognized THEN rejected → rejected wins.
    // But `at` is reversed (the "rejected" event carries an EARLIER wall-clock than the "recognized").
    const recognizedLate: RecognitionEvent = {
      id: 'evt_a', businessRef: A, snapshotId: 'snap_1', statementSemanticKey: SK, statementVersionId: V1,
      response: 'founder_recognized', at: '2025-01-06T09:00:00.000Z', clientEventId: 'ca',
    };
    const rejectedEarly: RecognitionEvent = {
      id: 'evt_b', businessRef: A, snapshotId: 'snap_1', statementSemanticKey: SK, statementVersionId: V1,
      response: 'founder_rejected', at: '2025-01-06T01:00:00.000Z', clientEventId: 'cb',
    };
    // Array order (append_seq order) is [recognizedLate, rejectedEarly] → latest exact = rejected.
    expect(projectRecognition(V1, [recognizedLate, rejectedEarly])).toBe('founder_rejected');
    // Sorting by `at` would have said recognized — proving `at` is irrelevant to projection.
  });
});

describe('hasDirectEvent', () => {
  it('true when an event targets the current versionId', () => {
    expect(hasDirectEvent(V1, [ev(V2, 'founder_recognized'), ev(V1, 'founder_qualified')])).toBe(true);
  });
  it('false when only non-exact events exist', () => {
    expect(hasDirectEvent(V1, [ev(V2, 'founder_recognized')])).toBe(false);
  });
  it('false when there is no history', () => {
    expect(hasDirectEvent(V1, [])).toBe(false);
  });
});

describe('mapReviewResponseToStatus', () => {
  it('frame_broadly_recognized → reviewed', () => {
    expect(mapReviewResponseToStatus('frame_broadly_recognized')).toBe('reviewed');
  });
  it('corrections_requested → partially_reviewed', () => {
    expect(mapReviewResponseToStatus('corrections_requested')).toBe('partially_reviewed');
  });
  it('continued_without_review → continued_without_review', () => {
    expect(mapReviewResponseToStatus('continued_without_review')).toBe('continued_without_review');
  });
});

describe('deriveSnapshotStatus', () => {
  it('no review + no direct event → draft', () => {
    expect(deriveSnapshotStatus({ anyDirectEvent: false })).toBe('draft');
  });
  it('no review + a direct event → partially_reviewed', () => {
    expect(deriveSnapshotStatus({ anyDirectEvent: true })).toBe('partially_reviewed');
  });
  it('review present overrides direct events → reviewed', () => {
    expect(deriveSnapshotStatus({ latestReview: review('frame_broadly_recognized'), anyDirectEvent: true })).toBe('reviewed');
  });
  it('review corrections_requested → partially_reviewed', () => {
    expect(deriveSnapshotStatus({ latestReview: review('corrections_requested'), anyDirectEvent: false })).toBe('partially_reviewed');
  });
  it('review continued_without_review → continued_without_review', () => {
    expect(deriveSnapshotStatus({ latestReview: review('continued_without_review'), anyDirectEvent: true })).toBe('continued_without_review');
  });
});
