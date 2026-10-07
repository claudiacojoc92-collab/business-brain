import { describe, it, expect } from 'vitest';
import { FixedClock, businessRefKey, type DeclarationKind, type FounderDeclaration, type SubjectRef } from '@bb/domain';
import { DeclarationAppendService } from '../../understanding/declaration-append.service';
import type { DeclarationAppendCommand } from '../../understanding/declaration-ports';
import {
  emptyDeclStore,
  seedDeclarationRow,
  directDeclarationLog,
  declarationUow,
  scopedDeclarations,
  CapturingDeclarationEventSink,
  type DeclStore,
} from './in-memory-declaration';

const A: SubjectRef = { type: 'business', id: 'A' };
const B: SubjectRef = { type: 'business', id: 'B' };
const SUBJECT: SubjectRef = { type: 'offer', id: 'offer_1' };
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

function service(store: DeclStore, opts?: { failOn?: 'append' }) {
  const events = new CapturingDeclarationEventSink();
  const svc = new DeclarationAppendService({ uow: declarationUow(store, opts), clock, events });
  return { svc, events };
}
function cmd(over: Partial<DeclarationAppendCommand> = {}): DeclarationAppendCommand {
  return { businessRef: A, kind: 'self_report', subject: SUBJECT, statement: 'We serve local runners.', clientEventId: 'client_1', ...over };
}
const seqOf = (store: DeclStore, ref: SubjectRef): number => store.declSeq.get(businessRefKey(ref)) ?? 0;

describe('DeclarationAppendService — append + validation (§3, §13)', () => {
  it('appends an immutable declaration, stamps founder_declared + id + declaredAt', async () => {
    const store = emptyDeclStore();
    const { svc, events } = service(store);
    const r = await svc.append(cmd());
    expect(r.replayed).toBe(false);
    expect(r.declaration.id).toBeTruthy();
    expect(r.declaration.provenance).toBe('founder_declared');
    expect(r.declaration.declaredAt).toBe('2025-01-06T04:00:00.000Z');
    expect(r.declaration.kind).toBe('self_report');
    expect(r.declaration.subject).toEqual(SUBJECT);
    expect(r.declaration.statement).toBe('We serve local runners.');
    expect(scopedDeclarations(store, A)).toHaveLength(1);
    expect(events.appended).toEqual([{ declarationId: r.declaration.id, kind: 'self_report', replayed: false }]);
  });

  it('records the founder\'s own supersedes pointer verbatim (never resolved)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    const r = await svc.append(cmd({ supersedes: 'decl_prior', clientEventId: 'c1' }));
    expect(r.declaration.supersedes).toBe('decl_prior');
    // The pointed-to declaration is NOT loaded, marked, or removed — it is opaque founder data.
    expect(scopedDeclarations(store, A)).toHaveLength(1);
  });

  it('rejects an unsupported kind → DECLARATION_INVALID_PAYLOAD (422)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await expect(svc.append(cmd({ kind: 'verified' as unknown as DeclarationKind }))).rejects.toMatchObject({ code: 'DECLARATION_INVALID_PAYLOAD', httpStatus: 422 });
    expect(scopedDeclarations(store, A)).toHaveLength(0);
  });

  it('rejects an empty statement → DECLARATION_INVALID_PAYLOAD (422)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await expect(svc.append(cmd({ statement: '   ' }))).rejects.toMatchObject({ code: 'DECLARATION_INVALID_PAYLOAD', httpStatus: 422 });
    expect(scopedDeclarations(store, A)).toHaveLength(0);
  });

  it('preserves statement whitespace (validate-with-trim, persist-original) and replays deterministically', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    const first = await svc.append(cmd({ statement: '  we serve runners  ', clientEventId: 'ws' }));
    expect(first.declaration.statement).toBe('  we serve runners  '); // original preserved, not trimmed
    // An identical retry (same untrimmed bytes) replays across all layers — no whitespace disagreement.
    const replay = await svc.append(cmd({ statement: '  we serve runners  ', clientEventId: 'ws' }));
    expect(replay.replayed).toBe(true);
    expect(replay.declaration.id).toBe(first.declaration.id);
    expect(scopedDeclarations(store, A)).toHaveLength(1);
  });

  it('accepts every frozen declaration kind (append-only, no truth assertion)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    const kinds: DeclarationKind[] = ['self_report', 'intent', 'decision', 'objective', 'preference', 'constraint'];
    for (const [i, kind] of kinds.entries()) await svc.append(cmd({ kind, clientEventId: `c${i}` }));
    expect(scopedDeclarations(store, A)).toHaveLength(6);
  });
});

describe('DeclarationAppendService — append-only (§4)', () => {
  it('a later declaration coexists with the earlier one; earlier stays immutable', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    const first = await svc.append(cmd({ clientEventId: 'c1', statement: 'first' }));
    await svc.append(cmd({ clientEventId: 'c2', statement: 'second', supersedes: first.declaration.id }));
    const all = scopedDeclarations(store, A);
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(first.declaration.id);
    expect(all[0]!.statement).toBe('first'); // unchanged despite the later declaration claiming to supersede it
  });
});

describe('DeclarationAppendService — ordering (§7): append sequence, not timestamp', () => {
  it('history follows append_seq even when timestamps are reversed', async () => {
    const store = emptyDeclStore();
    seedDeclarationRow(store, A, { id: 'd_late', businessRef: A, kind: 'intent', subject: SUBJECT, statement: 'late', provenance: 'founder_declared', declaredAt: '2025-01-06T09:00:00.000Z' }, 'c_late');
    seedDeclarationRow(store, A, { id: 'd_early', businessRef: A, kind: 'intent', subject: SUBJECT, statement: 'early', provenance: 'founder_declared', declaredAt: '2025-01-06T01:00:00.000Z' }, 'c_early');
    const history = await directDeclarationLog(store).history(A);
    expect(history.map((d) => d.id)).toEqual(['d_late', 'd_early']); // append_seq ascending, ignores declaredAt
  });

  it('effectiveUnderstanding returns understanding-eligible kinds only, append-ordered', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await svc.append(cmd({ clientEventId: 'c1', kind: 'self_report', statement: 's' }));
    await svc.append(cmd({ clientEventId: 'c2', kind: 'preference', statement: 'p' })); // not eligible
    await svc.append(cmd({ clientEventId: 'c3', kind: 'decision', statement: 'd' }));
    const eligible = await directDeclarationLog(store).effectiveUnderstanding(A);
    expect(eligible.map((d) => d.kind)).toEqual(['self_report', 'decision']);
  });
});

describe('DeclarationAppendService — idempotency (§5)', () => {
  it('an equivalent retry returns the ORIGINAL declaration, replayed:true, no new sequence, no side effect', async () => {
    const store = emptyDeclStore();
    const { svc, events } = service(store);
    const first = await svc.append(cmd());
    expect(seqOf(store, A)).toBe(1);
    const second = await svc.append(cmd());
    expect(second.replayed).toBe(true);
    expect(second.declaration.id).toBe(first.declaration.id);
    expect(scopedDeclarations(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
    expect(events.appended.map((e) => e.replayed)).toEqual([false]);
  });

  it('same clientEventId + different statement → governed conflict (409)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await svc.append(cmd({ statement: 'first' }));
    await expect(svc.append(cmd({ statement: 'changed' }))).rejects.toMatchObject({ code: 'DECLARATION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedDeclarations(store, A)).toHaveLength(1);
  });

  it('same clientEventId + different subject → governed conflict (409)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await svc.append(cmd());
    await expect(svc.append(cmd({ subject: { type: 'audience_segment', id: 'other' } }))).rejects.toMatchObject({ code: 'DECLARATION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedDeclarations(store, A)).toHaveLength(1);
  });

  it('same clientEventId + different supersedes pointer → governed conflict (409)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await svc.append(cmd({ supersedes: 'd1' }));
    await expect(svc.append(cmd({ supersedes: 'd2' }))).rejects.toMatchObject({ code: 'DECLARATION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
  });

  it('no raw persistence error escapes for a clientEventId conflict', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await svc.append(cmd({ statement: 'first' }));
    let err: unknown;
    try {
      await svc.append(cmd({ statement: 'changed' }));
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string }).code).toBe('DECLARATION_CLIENT_EVENT_CONFLICT');
    expect((err as Error).message).not.toMatch(/declaration conflict for/);
  });

  it('an assigned declaration-id collision with divergent content → typed declaration_id_conflict (no raw error)', async () => {
    const store = emptyDeclStore();
    const existing: FounderDeclaration = { id: 'd_fixed', businessRef: A, kind: 'self_report', subject: SUBJECT, statement: 'orig', provenance: 'founder_declared', declaredAt: '2025-01-06T04:00:00.000Z' };
    seedDeclarationRow(store, A, existing, 'c_orig');
    const collision: FounderDeclaration = { ...existing, statement: 'divergent' };
    const outcome = await directDeclarationLog(store).appendIdempotent(A, collision, 'c_new');
    expect(outcome.kind).toBe('declaration_id_conflict');
  });
});

describe('DeclarationAppendService — concurrency + isolation (§5, §6, §7)', () => {
  it('first-ever concurrent append starts with NO counter row and yields two unique sequences', async () => {
    const store = emptyDeclStore();
    expect(store.declSeq.has(businessRefKey(A))).toBe(false);
    const { svc } = service(store);
    const results = await Promise.all([
      svc.append(cmd({ clientEventId: 'c_a', statement: 'a' })),
      svc.append(cmd({ clientEventId: 'c_b', statement: 'b' })),
    ]);
    expect(results.every((r) => !r.replayed)).toBe(true);
    expect(scopedDeclarations(store, A)).toHaveLength(2);
    expect(store.declSeq.get(businessRefKey(A))).toBe(2);
  });

  it('equivalent concurrent submissions store exactly one (one sequence)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    const results = await Promise.all([svc.append(cmd({ clientEventId: 'same' })), svc.append(cmd({ clientEventId: 'same' }))]);
    expect(scopedDeclarations(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
  });

  it('conflicting concurrent submissions → one stored + one governed conflict', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    const settled = await Promise.allSettled([svc.append(cmd({ statement: 'x' })), svc.append(cmd({ statement: 'y' }))]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(rejected[0]!.reason).toMatchObject({ code: 'DECLARATION_CLIENT_EVENT_CONFLICT', httpStatus: 409 });
    expect(scopedDeclarations(store, A)).toHaveLength(1);
    expect(seqOf(store, A)).toBe(1);
  });

  it('rolls back with no declaration on an injected append failure', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store, { failOn: 'append' });
    await expect(svc.append(cmd())).rejects.toThrow(/injected declaration-append failure/);
    expect(scopedDeclarations(store, A)).toHaveLength(0);
    expect(seqOf(store, A)).toBe(0);
  });

  it('the same clientEventId is independent across businesses', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await svc.append(cmd({ businessRef: A, clientEventId: 'shared' }));
    const rb = await svc.append(cmd({ businessRef: B, clientEventId: 'shared' }));
    expect(rb.replayed).toBe(false);
    expect(scopedDeclarations(store, A)).toHaveLength(1);
    expect(scopedDeclarations(store, B)).toHaveLength(1);
  });

  it('business A declarations are invisible to business B (history isolation)', async () => {
    const store = emptyDeclStore();
    const { svc } = service(store);
    await svc.append(cmd({ businessRef: A, clientEventId: 'c1' }));
    expect(await directDeclarationLog(store).history(B)).toHaveLength(0);
  });

  it('identical DeclarationId strings in different businesses coexist (composite (business_ref, id))', async () => {
    const store = emptyDeclStore();
    const dupA: FounderDeclaration = { id: 'dup', businessRef: A, kind: 'self_report', subject: SUBJECT, statement: 'A says', provenance: 'founder_declared', declaredAt: '2025-01-06T04:00:00.000Z' };
    const dupB: FounderDeclaration = { id: 'dup', businessRef: B, kind: 'self_report', subject: SUBJECT, statement: 'B says', provenance: 'founder_declared', declaredAt: '2025-01-06T04:00:00.000Z' };
    seedDeclarationRow(store, A, dupA, 'ca');
    seedDeclarationRow(store, B, dupB, 'cb');
    const histA = await directDeclarationLog(store).history(A);
    const histB = await directDeclarationLog(store).history(B);
    expect(histA).toHaveLength(1);
    expect(histB).toHaveLength(1);
    expect(histA[0]!.id).toBe('dup');
    expect(histB[0]!.id).toBe('dup');
    expect(histA[0]!.statement).toBe('A says'); // no cross-business collision despite identical id
    expect(histB[0]!.statement).toBe('B says');
  });
});
