import { describe, it, expect } from 'vitest';
import type { Claim, SubjectRef } from '@bb/domain';
import { ClaimAppendService } from '../../understanding/claim-append.service';
import { ClaimReadService } from '../../understanding/claim-read.service';
import type { ClaimAppendCommand } from '../../understanding/claim-ports';
import {
  emptyClaimStore,
  seedSnapshot,
  seedClaimRow,
  claimUow,
  directClaimLog,
  snapshotViewService,
  scopedClaims,
  CapturingClaimEventSink,
  type ClaimStore,
} from './in-memory-claim';

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const OFFER: SubjectRef = { type: 'offer', id: 'offer_1' };
const CHANNEL: SubjectRef = { type: 'channel', id: 'ig' };
const SK = 'understanding.snapshot.demo.audience::business:A';
const V = 'stmtver_A1';
const clock = { now: () => '2025-01-06T04:00:00.000Z' };

function appendService(store: ClaimStore) {
  return new ClaimAppendService({ uow: claimUow(store), clock, events: new CapturingClaimEventSink() });
}
function cmd(over: Partial<ClaimAppendCommand> = {}): ClaimAppendCommand {
  return { businessRef: A, subject: OFFER, predicate: 'primary_offer', object: 'coaching', clientEventId: 'c1', ...over };
}
function claim(id: string, over: Partial<Claim> = {}): Claim {
  return { id, businessRef: A, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z', ...over };
}

describe('ClaimReadService — read boundary (byId / history / bySubject only)', () => {
  it('exposes only byId, history, bySubject (no evaluative reads)', () => {
    const read = new ClaimReadService({ claims: directClaimLog(emptyClaimStore()) });
    const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(read)).filter((k) => k !== 'constructor');
    expect(keys.sort()).toEqual(['byId', 'bySubject', 'history']);
    for (const banned of ['latest', 'current', 'effective', 'active', 'resolved', 'accepted', 'verified', 'strongest', 'supported', 'contradicted', 'evaluated']) {
      expect((read as unknown as Record<string, unknown>)[banned]).toBeUndefined();
    }
  });

  it('history and bySubject return APPEND order, ignoring recordedAt (reversed timestamps)', async () => {
    const store = emptyClaimStore();
    // Append order: late-timestamp first, early-timestamp second. append_seq order wins.
    seedClaimRow(store, A, claim('c_late', { recordedAt: '2025-01-06T09:00:00.000Z' }), 'cl');
    seedClaimRow(store, A, claim('c_early', { recordedAt: '2025-01-06T01:00:00.000Z' }), 'ce');
    const read = new ClaimReadService({ claims: directClaimLog(store) });
    expect((await read.history(A)).map((c) => c.id)).toEqual(['c_late', 'c_early']);
    expect((await read.bySubject(A, OFFER)).map((c) => c.id)).toEqual(['c_late', 'c_early']);
  });

  it('bySubject is exact-subject scoped; interleaved subjects preserve per-subject append order', async () => {
    const store = emptyClaimStore();
    const svc = appendService(store);
    await svc.append(cmd({ clientEventId: 'o1', subject: OFFER, object: 'o1' }));
    await svc.append(cmd({ clientEventId: 'ch1', subject: CHANNEL, object: 'ch1' }));
    await svc.append(cmd({ clientEventId: 'o2', subject: OFFER, object: 'o2' }));
    const read = new ClaimReadService({ claims: directClaimLog(store) });
    expect((await read.bySubject(A, OFFER)).map((c) => c.object)).toEqual(['o1', 'o2']);
    expect((await read.bySubject(A, CHANNEL)).map((c) => c.object)).toEqual(['ch1']);
    expect(await read.bySubject(A, { type: 'audience_segment', id: 'none' })).toHaveLength(0);
  });

  it('reads are business-scoped and leak nothing across businesses', async () => {
    const store = emptyClaimStore();
    await appendService(store).append(cmd({ businessRef: A, clientEventId: 'c1' }));
    const read = new ClaimReadService({ claims: directClaimLog(store) });
    expect(await read.history(B)).toHaveLength(0);
    expect(await read.bySubject(B, OFFER)).toHaveLength(0);
    const created = (await read.history(A))[0]!;
    expect(await read.byId(B, created.id)).toBeNull(); // A's claim id not visible under B
  });

  it('reads perform no writes (sequence unchanged after reads)', async () => {
    const store = emptyClaimStore();
    await appendService(store).append(cmd());
    const read = new ClaimReadService({ claims: directClaimLog(store) });
    await read.history(A);
    await read.bySubject(A, OFFER);
    expect(store.claimSeq.get('business:A')).toBe(1);
  });
});

describe('lifecycle isolation — a Claim alters NO other lifecycle (§20)', () => {
  it('appending claims (including contradictory ones) does not change the snapshot view', async () => {
    const store = emptyClaimStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    const before = await snapshotViewService(store).viewById(A, 'snap_A');
    expect(before.status).toBe('draft');

    const svc = appendService(store);
    await svc.append(cmd({ clientEventId: 'c1', predicate: 'is_active', object: true }));
    await svc.append(cmd({ clientEventId: 'c2', predicate: 'is_active', object: false })); // contradictory
    expect(scopedClaims(store, A)).toHaveLength(2);

    const after = await snapshotViewService(store).viewById(A, 'snap_A');
    expect(after.status).toBe('draft'); // unchanged — a claim is not recognition/review/presentation
    expect(after.latestReview).toBeUndefined();
    expect([...after.statementRecognitions.values()]).toEqual(['unconfirmed']);
    expect(after.snapshot).toEqual(before.snapshot); // immutable version untouched
    expect(after.snapshot.declaredContext).toEqual([]);
  });
});
