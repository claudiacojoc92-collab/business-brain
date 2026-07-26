import { describe, it, expect } from 'vitest';
import { businessRefKey, type Claim, type ClaimObject, type SubjectRef } from '@bb/domain';
import { ClaimAppendService } from '../../understanding/claim-append.service';
import type { ClaimAppendCommand } from '../../understanding/claim-ports';
import {
  emptyClaimStore,
  seedClaimRow,
  directClaimLog,
  claimUow,
  scopedClaims,
  CapturingClaimEventSink,
  type ClaimStore,
} from './in-memory-claim';

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const OFFER: SubjectRef = { type: 'offer', id: 'offer_1' };
const clock = { now: () => '2025-01-06T04:00:00.000Z' };

function service(store: ClaimStore, opts?: { failOn?: 'append' }) {
  const events = new CapturingClaimEventSink();
  const svc = new ClaimAppendService({ uow: claimUow(store, opts), clock, events });
  return { svc, events };
}
function cmd(over: Partial<ClaimAppendCommand> = {}): ClaimAppendCommand {
  return { businessRef: A, subject: OFFER, predicate: 'primary_offer', object: 'coaching', clientEventId: 'client_1', ...over };
}
const seqOf = (store: ClaimStore, ref: SubjectRef): number => store.claimSeq.get(businessRefKey(ref)) ?? 0;

describe('ClaimAppendService — append + validation', () => {
  it('appends an immutable claim (string object), assigns id + recordedAt', async () => {
    const store = emptyClaimStore();
    const { svc, events } = service(store);
    const r = await svc.append(cmd());
    expect(r.replayed).toBe(false);
    expect(r.claim.id).toBeTruthy();
    expect(r.claim.recordedAt).toBe('2025-01-06T04:00:00.000Z');
    expect(r.claim.subject).toEqual(OFFER);
    expect(r.claim.predicate).toBe('primary_offer');
    expect(r.claim.object).toBe('coaching');
    expect(scopedClaims(store, A)).toHaveLength(1);
    expect(events.appended).toEqual([{ claimId: r.claim.id, replayed: false }]);
  });

  it('accepts number and boolean objects', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    const n = await svc.append(cmd({ clientEventId: 'c1', predicate: 'posts_per_week', object: 2 }));
    const b = await svc.append(cmd({ clientEventId: 'c2', predicate: 'is_active', object: true }));
    expect(n.claim.object).toBe(2);
    expect(b.claim.object).toBe(true);
  });

  it('rejects invalid business ref → CLAIM_INVALID_BUSINESS_REF (422)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await expect(svc.append(cmd({ businessRef: { type: 'offer', id: 'x' } }))).rejects.toMatchObject({ code: 'CLAIM_INVALID_BUSINESS_REF', httpStatus: 422 });
  });

  it('rejects structurally invalid subject → CLAIM_INVALID_SUBJECT (422)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await expect(svc.append(cmd({ subject: { type: 'bogus' as SubjectRef['type'], id: 'x' } }))).rejects.toMatchObject({ code: 'CLAIM_INVALID_SUBJECT', httpStatus: 422 });
    await expect(svc.append(cmd({ subject: { type: 'offer', id: '  ' } }))).rejects.toMatchObject({ code: 'CLAIM_INVALID_SUBJECT' });
  });

  it('rejects empty / whitespace-only predicate → CLAIM_INVALID_PREDICATE (422)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await expect(svc.append(cmd({ predicate: '' }))).rejects.toMatchObject({ code: 'CLAIM_INVALID_PREDICATE', httpStatus: 422 });
    await expect(svc.append(cmd({ predicate: '   ' }))).rejects.toMatchObject({ code: 'CLAIM_INVALID_PREDICATE' });
    expect(scopedClaims(store, A)).toHaveLength(0);
  });

  it('rejects non-scalar / non-finite objects → CLAIM_INVALID_OBJECT (422)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, [1, 2], { a: 1 }]) {
      await expect(svc.append(cmd({ object: bad as unknown as ClaimObject }))).rejects.toMatchObject({ code: 'CLAIM_INVALID_OBJECT', httpStatus: 422 });
    }
    expect(scopedClaims(store, A)).toHaveLength(0);
  });

  it('persists the ORIGINAL predicate (validate-with-trim, persist-original)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    const r = await svc.append(cmd({ predicate: '  primary_offer  ', clientEventId: 'ws' }));
    expect(r.claim.predicate).toBe('  primary_offer  ');
  });
});

describe('ClaimAppendService — append-only (contradictory & duplicate coexist)', () => {
  it('an equivalent proposition with a NEW clientEventId coexists (two rows)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'c1' }));
    await svc.append(cmd({ clientEventId: 'c2' })); // identical proposition, different key
    expect(scopedClaims(store, A)).toHaveLength(2);
  });

  it('a contradictory proposition coexists (no resolution)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'c1', predicate: 'is_active', object: true }));
    await svc.append(cmd({ clientEventId: 'c2', predicate: 'is_active', object: false }));
    const all = scopedClaims(store, A);
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.object).sort()).toEqual([false, true]);
  });
});

describe('ClaimAppendService — idempotency + typed replay equality', () => {
  it('equivalent replay returns the ORIGINAL claim, replayed:true, no new sequence/side effect', async () => {
    const store = emptyClaimStore();
    const { svc, events } = service(store);
    const first = await svc.append(cmd());
    expect(seqOf(store, A)).toBe(1);
    const second = await svc.append(cmd());
    expect(second.replayed).toBe(true);
    expect(second.claim.id).toBe(first.claim.id);
    expect(scopedClaims(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
    expect(events.appended.map((e) => e.replayed)).toEqual([false]);
  });

  it('changed subject / predicate / object value / object TYPE all conflict (409)', async () => {
    const cases: Array<Partial<ClaimAppendCommand>> = [
      { subject: { type: 'audience_segment', id: 'x' } },
      { predicate: 'other' },
      { predicate: 'Primary_offer' }, // case change
      { predicate: ' primary_offer' }, // whitespace change
      { object: 'yoga' }, // value change
      { object: 1 as unknown as ClaimObject }, // "coaching"(string) vs 1(number) — but base is string; use a numeric base below
    ];
    for (const [i, over] of cases.entries()) {
      const store = emptyClaimStore();
      const { svc } = service(store);
      await svc.append(cmd());
      await expect(svc.append(cmd(over))).rejects.toMatchObject({ code: 'CLAIM_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
      expect(scopedClaims(store, A)).toHaveLength(1);
      void i;
    }
  });

  it('object TYPE change conflicts: "1" (string) vs 1 (number), "true" vs true', async () => {
    const store1 = emptyClaimStore();
    const s1 = service(store1).svc;
    await s1.append(cmd({ predicate: 'p', object: '1' }));
    await expect(s1.append(cmd({ predicate: 'p', object: 1 }))).rejects.toMatchObject({ code: 'CLAIM_CLIENT_EVENT_CONFLICT' });

    const store2 = emptyClaimStore();
    const s2 = service(store2).svc;
    await s2.append(cmd({ predicate: 'p', object: 'true' }));
    await expect(s2.append(cmd({ predicate: 'p', object: true }))).rejects.toMatchObject({ code: 'CLAIM_CLIENT_EVENT_CONFLICT' });
  });

  it('a fresh generated id/recordedAt on retry still replays (server fields excluded from intent)', async () => {
    const store = emptyClaimStore();
    // Two different clocks → different recordedAt; still a replay because recordedAt is not in intent.
    const svcEarly = new ClaimAppendService({ uow: claimUow(store), clock: { now: () => '2025-01-06T01:00:00.000Z' }, events: new CapturingClaimEventSink() });
    const svcLate = new ClaimAppendService({ uow: claimUow(store), clock: { now: () => '2025-01-06T09:00:00.000Z' }, events: new CapturingClaimEventSink() });
    const first = await svcEarly.append(cmd());
    const second = await svcLate.append(cmd());
    expect(second.replayed).toBe(true);
    expect(second.claim.id).toBe(first.claim.id);
    expect(second.claim.recordedAt).toBe(first.claim.recordedAt); // original returned
  });

  it('no raw persistence error escapes for a clientEventId conflict', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await svc.append(cmd({ object: 'a' }));
    let err: unknown;
    try {
      await svc.append(cmd({ object: 'b' }));
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string }).code).toBe('CLAIM_CLIENT_EVENT_CONFLICT');
    expect((err as Error).message).not.toMatch(/claim conflict for id/);
  });

  it('an assigned ClaimId collision with divergent content → typed claim_id_conflict', async () => {
    const store = emptyClaimStore();
    const existing: Claim = { id: 'c_fixed', businessRef: A, subject: OFFER, predicate: 'p', object: 'orig', recordedAt: '2025-01-06T04:00:00.000Z' };
    seedClaimRow(store, A, existing, 'c_orig');
    const collision: Claim = { ...existing, object: 'divergent' };
    const outcome = await directClaimLog(store).appendIdempotent(A, collision, 'c_new');
    expect(outcome.kind).toBe('claim_id_conflict');
  });
});

describe('ClaimAppendService — concurrency + rollback', () => {
  it('first-ever concurrent append starts with NO counter row and yields two unique sequences', async () => {
    const store = emptyClaimStore();
    expect(store.claimSeq.has(businessRefKey(A))).toBe(false);
    const { svc } = service(store);
    const results = await Promise.all([svc.append(cmd({ clientEventId: 'c_a', object: 'a' })), svc.append(cmd({ clientEventId: 'c_b', object: 'b' }))]);
    expect(results.every((r) => !r.replayed)).toBe(true);
    expect(scopedClaims(store, A)).toHaveLength(2);
    expect(store.claimSeq.get(businessRefKey(A))).toBe(2);
  });

  it('equivalent concurrent submissions store exactly one (one sequence)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    const results = await Promise.all([svc.append(cmd({ clientEventId: 'same' })), svc.append(cmd({ clientEventId: 'same' }))]);
    expect(scopedClaims(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
  });

  it('conflicting concurrent submissions → one stored + one governed conflict (no extra sequence)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    const settled = await Promise.allSettled([svc.append(cmd({ object: 'x' })), svc.append(cmd({ object: 'y' }))]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(rejected[0]!.reason).toMatchObject({ code: 'CLAIM_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedClaims(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
  });

  it('rolls back with no claim + no sequence movement on an injected append failure', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store, { failOn: 'append' });
    await expect(svc.append(cmd())).rejects.toThrow(/injected claim-append failure/);
    expect(scopedClaims(store, A)).toHaveLength(0);
    expect(seqOf(store, A)).toBe(0);
  });
});

describe('ClaimAppendService — numeric policy (finite float64, negative zero)', () => {
  it('normalizes -0 to +0 before persistence (deterministic; DB never stores -0)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    const r = await svc.append(cmd({ predicate: 'delta', object: -0 }));
    expect(Object.is(r.claim.object, 0)).toBe(true); // +0
    expect(Object.is(r.claim.object, -0)).toBe(false); // not -0
    // A subsequent equivalent append with +0 replays (0 and -0 are equal ClaimObject values).
    const replay = await svc.append(cmd({ predicate: 'delta', object: 0 }));
    expect(replay.replayed).toBe(true);
    expect(replay.claim.id).toBe(r.claim.id);
  });

  it('round-trips representative finite numbers (int, decimal, negative, tiny, large-but-finite)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    const values = [0, 1, -1, 42, 0.1, 0.2, 0.3, -273.15, 1e-300, 9007199254740993, 1.7976931348623157e308];
    for (const [i, v] of values.entries()) {
      const r = await svc.append(cmd({ clientEventId: `n${i}`, predicate: `p${i}`, object: v }));
      expect(r.claim.object).toBe(v);
    }
  });
});

describe('ClaimAppendService — server-generated ClaimId collision + sequence (§3, §10)', () => {
  it('two colliding ids then a free id → one Claim, ONE committed sequence, clientEventId unchanged, sink once', async () => {
    const store = emptyClaimStore();
    seedClaimRow(store, A, { id: 'dup', businessRef: A, subject: OFFER, predicate: 'p', object: 'seeded', recordedAt: '2025-01-06T04:00:00.000Z' }, 'seed'); // seq→1
    let i = 0;
    const ids = ['dup', 'dup', 'fresh'];
    const events = new CapturingClaimEventSink();
    const svc = new ClaimAppendService({ uow: claimUow(store), clock, events, idGenerator: () => ids[i++]! });
    const r = await svc.append(cmd({ clientEventId: 'new', object: 'v' }));
    expect(r.replayed).toBe(false);
    expect(r.claim.id).toBe('fresh'); // retried past two collisions
    expect(scopedClaims(store, A)).toHaveLength(2); // seed + new
    expect(seqOf(store, A)).toBe(2); // exactly ONE increment by the append (collisions consumed none)
    expect(events.appended).toHaveLength(1); // sink invoked once
  });

  it('a persistent id collision → CLAIM_ID_CONFLICT 500, no Claim, no committed sequence, no sink', async () => {
    const store = emptyClaimStore();
    seedClaimRow(store, A, { id: 'dup', businessRef: A, subject: OFFER, predicate: 'p', object: 'seeded', recordedAt: '2025-01-06T04:00:00.000Z' }, 'seed'); // seq→1
    const events = new CapturingClaimEventSink();
    const svc = new ClaimAppendService({ uow: claimUow(store), clock, events, idGenerator: () => 'dup' });
    await expect(svc.append(cmd({ clientEventId: 'new', object: 'v' }))).rejects.toMatchObject({ code: 'CLAIM_ID_CONFLICT', httpStatus: 500 });
    expect(scopedClaims(store, A)).toHaveLength(1); // only the seed
    expect(seqOf(store, A)).toBe(1); // no increment consumed by the failed append
    expect(events.appended).toHaveLength(0); // no sink call
  });
});

describe('authoritative ClaimLog boundary (§1) — appendIdempotent validates clientEventId', () => {
  it('rejects empty / whitespace / non-string clientEventId via a DIRECT ClaimLog call', async () => {
    const store = emptyClaimStore();
    const log = directClaimLog(store);
    const c: Claim = { id: 'k', businessRef: A, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z' };
    for (const bad of ['', '   ', 5 as unknown as string, null as unknown as string]) {
      await expect(log.appendIdempotent(A, c, bad)).rejects.toMatchObject({ code: 'CLAIM_INVALID_CLIENT_EVENT_ID', httpStatus: 422 });
    }
    expect(scopedClaims(store, A)).toHaveLength(0);
  });
});

describe('frozen ClaimRepository.append (§2) — recordedAt participates in identity', () => {
  const c: Claim = { id: 'ra', businessRef: A, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z' };
  it('same id + same proposition + DIFFERENT recordedAt → CLAIM_ID_CONFLICT', async () => {
    const store = emptyClaimStore();
    const log = directClaimLog(store);
    await log.append(A, c);
    await expect(log.append(A, { ...c, recordedAt: '2025-01-06T05:00:00.000Z' })).rejects.toMatchObject({ code: 'CLAIM_ID_CONFLICT' });
  });
  it('exact same Claim (all frozen fields) → idempotent no-op', async () => {
    const store = emptyClaimStore();
    const log = directClaimLog(store);
    await log.append(A, c);
    await log.append(A, { ...c });
    expect(scopedClaims(store, A)).toHaveLength(1);
  });
});

describe('ClaimAppendService — best-effort sink (§13)', () => {
  it('a throwing post-commit sink does not roll back or fail the committed claim', async () => {
    const store = emptyClaimStore();
    const throwingSink = { claimAppended: () => { throw new Error('sink down'); } };
    const svc = new ClaimAppendService({ uow: claimUow(store), clock, events: throwingSink });
    const r = await svc.append(cmd());
    expect(r.replayed).toBe(false);
    expect(scopedClaims(store, A)).toHaveLength(1); // claim committed despite sink failure
  });
});

describe('frozen ClaimRepository.append (§11) — lower-level non-command append', () => {
  it('is idempotent by (businessRef, id): identical re-append creates no second row', async () => {
    const store = emptyClaimStore();
    const log = directClaimLog(store);
    const c: Claim = { id: 'k1', businessRef: A, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z' };
    await log.append(A, c);
    await log.append(A, c); // identical → no-op
    expect(scopedClaims(store, A)).toHaveLength(1);
  });

  it('divergent content under an existing id fails loudly', async () => {
    const store = emptyClaimStore();
    const log = directClaimLog(store);
    const c: Claim = { id: 'k1', businessRef: A, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z' };
    await log.append(A, c);
    // entity path: divergent content under an existing id → governed CLAIM_ID_CONFLICT (NOT a client-event conflict).
    await expect(log.append(A, { ...c, object: 'w' })).rejects.toMatchObject({ code: 'CLAIM_ID_CONFLICT', httpStatus: 500 });
  });

  it('does not synthesize a client-event identity (entity-path rows carry NULL command identity)', async () => {
    const store = emptyClaimStore();
    const log = directClaimLog(store);
    const c: Claim = { id: 'k2', businessRef: A, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z' };
    await log.append(A, c);
    // no client-event identity was invented from the claim id — findByClientEventId(id) must NOT match.
    expect(await log.findByClientEventId(A, 'k2')).toBeNull();
  });
});

describe('frozen ClaimRepository.append (§2, §3) — structural scope equality + governed mismatch', () => {
  const base: Claim = { id: 'sc1', businessRef: A, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z' };

  it('A. distinct objects with identical type/id are accepted (not reference equality)', async () => {
    const store = emptyClaimStore();
    const businessRefClone: SubjectRef = { type: 'business', id: 'A' }; // different object, same type/id
    await directClaimLog(store).append(businessRefClone, { ...base, businessRef: { type: 'business', id: 'A' } });
    expect(scopedClaims(store, A)).toHaveLength(1);
  });

  it('B. same type, different id → governed CLAIM_BUSINESS_SCOPE_MISMATCH', async () => {
    const store = emptyClaimStore();
    await expect(directClaimLog(store).append({ type: 'business', id: 'A' }, { ...base, businessRef: { type: 'business', id: 'Z' } })).rejects.toMatchObject({ code: 'CLAIM_BUSINESS_SCOPE_MISMATCH', httpStatus: 422 });
  });

  it('C. same id, different type → governed CLAIM_BUSINESS_SCOPE_MISMATCH', async () => {
    const store = emptyClaimStore();
    // claim.businessRef.type must be 'business'; a mismatched arg type is still rejected structurally.
    await expect(directClaimLog(store).append({ type: 'offer', id: 'A' }, { ...base, businessRef: { type: 'business', id: 'A' } })).rejects.toMatchObject({ code: 'CLAIM_BUSINESS_SCOPE_MISMATCH' });
  });
});

describe('ClaimAppendService — business isolation', () => {
  it('same clientEventId is independent across businesses', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await svc.append(cmd({ businessRef: A, clientEventId: 'shared' }));
    const rb = await svc.append(cmd({ businessRef: B, clientEventId: 'shared' }));
    expect(rb.replayed).toBe(false);
    expect(scopedClaims(store, A)).toHaveLength(1);
    expect(scopedClaims(store, B)).toHaveLength(1);
  });

  it('same clientEventId across different subjects within one business conflicts', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await svc.append(cmd({ subject: OFFER }));
    await expect(svc.append(cmd({ subject: { type: 'channel', id: 'ig' } }))).rejects.toMatchObject({ code: 'CLAIM_CLIENT_EVENT_CONFLICT' });
  });

  it('identical ClaimId across businesses coexist (composite (business_ref, id)); frozen append rejects scope mismatch', async () => {
    const store = emptyClaimStore();
    const dupA: Claim = { id: 'dup', businessRef: A, subject: OFFER, predicate: 'p', object: 'A', recordedAt: '2025-01-06T04:00:00.000Z' };
    const dupB: Claim = { id: 'dup', businessRef: B, subject: OFFER, predicate: 'p', object: 'B', recordedAt: '2025-01-06T04:00:00.000Z' };
    seedClaimRow(store, A, dupA, 'ca');
    seedClaimRow(store, B, dupB, 'cb');
    expect((await directClaimLog(store).byId(A, 'dup'))?.object).toBe('A');
    expect((await directClaimLog(store).byId(B, 'dup'))?.object).toBe('B');
    // frozen append precondition: businessRef must equal claim.businessRef → governed error
    await expect(directClaimLog(store).append(B, dupA)).rejects.toMatchObject({ code: 'CLAIM_BUSINESS_SCOPE_MISMATCH' });
  });
});

describe('ClaimAppendService — clientEventId validation (§1) + error-code separation (§6)', () => {
  it('rejects empty / whitespace-only / non-string clientEventId → CLAIM_INVALID_CLIENT_EVENT_ID (422)', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    for (const bad of ['', '   ', 123 as unknown as string, null as unknown as string, undefined as unknown as string]) {
      await expect(svc.append(cmd({ clientEventId: bad }))).rejects.toMatchObject({ code: 'CLAIM_INVALID_CLIENT_EVENT_ID', httpStatus: 422 });
    }
    expect(scopedClaims(store, A)).toHaveLength(0);
  });

  it('clientEventId comparison is exact (case- and whitespace-sensitive): distinct ids coexist as separate rows', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'event-1' }));
    await svc.append(cmd({ clientEventId: 'Event-1' })); // case differs → distinct command
    await svc.append(cmd({ clientEventId: ' event-1 ' })); // whitespace differs → distinct command
    expect(scopedClaims(store, A)).toHaveLength(3);
  });

  it('§6 exact code separation: client-event vs claim-id vs scope vs invalid-id are never conflated', async () => {
    const store = emptyClaimStore();
    const { svc } = service(store);
    // divergent clientEventId reuse → CLAIM_CLIENT_EVENT_CONFLICT
    await svc.append(cmd({ clientEventId: 'k', object: 'a' }));
    await expect(svc.append(cmd({ clientEventId: 'k', object: 'b' }))).rejects.toMatchObject({ code: 'CLAIM_CLIENT_EVENT_CONFLICT' });
    // divergent ClaimId reuse (entity path) → CLAIM_ID_CONFLICT (distinct from the above)
    const c: Claim = { id: 'z', businessRef: A, subject: OFFER, predicate: 'p', object: 'v', recordedAt: '2025-01-06T04:00:00.000Z' };
    await directClaimLog(store).append(A, c);
    await expect(directClaimLog(store).append(A, { ...c, object: 'w' })).rejects.toMatchObject({ code: 'CLAIM_ID_CONFLICT' });
    // scope mismatch → CLAIM_BUSINESS_SCOPE_MISMATCH
    await expect(directClaimLog(store).append(B, c)).rejects.toMatchObject({ code: 'CLAIM_BUSINESS_SCOPE_MISMATCH' });
  });
});
